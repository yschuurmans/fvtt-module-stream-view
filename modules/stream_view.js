import { StreamViewOptions } from './options.js';
import { toElement } from './dom.js';
import './types.js';

export class StreamView {
	/**
	 * @type {Socketlib|null}
	 */
	#socket = null;

	/**
	 * @type {string}
	 */
	#cameraMode = StreamViewOptions.CameraMode.AUTOMATIC;

	/**
	 * @type {string|null}
	 */
	#sceneId = null;

	/**
	 * @type {string|number|null}
	 */
	#levelId = null;

	/**
	 * @type {Map<string, Set<string>>}
	 * @protected
	 */
	_trackedTokens = new Map();

	/**
	 * Whether the running core supports native Scene Levels (Foundry v14+).
	 *
	 * NOTE: unverified against a live v14 client — the feature-detect
	 * expression below is a best guess and may need adjusting once the real
	 * v14 API surface is confirmed.
	 *
	 * @returns {boolean}
	 */
	static get levelsSupported() {
		return game.release.generation >= 14 && !!foundry.applications?.ui?.SceneNavigation;
	}

	/**
	 * @returns {boolean}
	 */
	static get isStreamUser() {
		return game?.user?.id === game.settings.get('stream-view', 'user-id');
	}

	/**
	 * @returns {User|null}
	 */
	static get streamUser() {
		return game.users.get(game.settings.get('stream-view', 'user-id'));
	}

	/**
	 * @param {Combat} combat
	 * @returns {boolean}
	 */
	static isCombatActive(combat = game.combat) {
		return combat?.current?.round > 0;
	}

	/**
	 * Check for player owner (omitting stream user)
	 *
	 * @param {Actor} actor
	 * @returns {boolean}
	 */
	static hasPlayerOwner(actor) {
		if (!actor) {
			return false;
		}
		return game.users.some((u) => !u.isGM && u.id !== game.settings.get('stream-view', 'user-id') && actor.testUserPermission(u, "OWNER"));
	}

	/**
	 * @param {Socketlib} socket 
	 */
	constructor(socket) {
		this.#socket = socket;
		this.#cameraMode = game.settings.get('stream-view', 'camera-mode');
	}

	/**
	 * @returns {string}
	 */
	get cameraMode() {
		return this.#cameraMode;
	}

	/**
	 * @returns {boolean}
	 */
	get isCameraAutomatic() {
		return (
			this.#cameraMode === StreamViewOptions.CameraMode.AUTOMATIC &&
			!(StreamView.isCombatActive() && game.settings.get('stream-view', 'directed-combat'))
		);
	}

	/**
	 * @returns {boolean}
	 */
	get isCameraDirected() {
		return (
			this.#cameraMode === StreamViewOptions.CameraMode.DIRECTED ||
			(StreamView.isCombatActive() && game.settings.get('stream-view', 'directed-combat'))
		);
	}

	/**
	 * @returns {boolean}
	 */
	get isCameraDisabled() {
		return (
			this.#cameraMode === StreamViewOptions.CameraMode.DISABLED &&
			!(StreamView.isCombatActive() && game.settings.get('stream-view', 'directed-combat'))
		);
	}

	/**
	 * @returns {Socketlib}
	 * @protected
	 */
	get _socket() {
		return this.#socket;
	}

	/**
	 * @returns {string|null}
	 * @protected
	 */
	get _sceneId() {
		return this.#sceneId;
	}

	/**
	 * @returns {string|number|null}
	 * @protected
	 */
	get _levelId() {
		return this.#levelId;
	}

	/**
	 * Compound scene+level key used to key {@link _trackedTokens}, so tracked
	 * tokens are kept separate per Scene Level. Degrades to a constant suffix
	 * (today's exact behavior) when levels aren't supported/in use.
	 *
	 * @returns {string}
	 * @protected
	 */
	get _trackedTokensKey() {
		return `${this.#sceneId}:${this.#levelId ?? ''}`;
	}

	/**
	 * @returns {boolean}
	 * @protected
	 */
	get _isCombatUser() {
		return false;
	}

	setup() {
		Hooks.on('canvasReady', () => this.#handleCanvasReady());
		Hooks.on('renderCameraViews', (_app, html) => this.#hideStreamAVUser(html));
		Hooks.on('updateToken', (doc) => this.#handleTrackedTokensUpdate(doc));
		Hooks.on('deleteToken', (doc) => this.#handleTrackedTokensDelete(doc));
	}

	/**
	 * @param {string} mode
	 */
	async setCameraMode(mode) {
		this.#cameraMode = mode;
	}

	/**
	 * @param {Coord} view
	 * @protected
	 */
	_directedPan(view) {
		if (!this.isCameraDirected || StreamView.streamUser?.viewedScene !== game.canvas.scene.id) {
			return;
		}
		if (StreamView.levelsSupported && view.level === undefined) {
			view = { ...view, level: this._currentLevelId() };
		}
		if (StreamView.isCombatActive() && game.settings.get('stream-view', 'directed-combat')) {
			if (this._isCombatUser) {
				this.#sendDirectedPan(view);
			}
		} else if (game.user.isGM) {
			this.#sendDirectedPan(view);
		}
	}

	/**
	 * @param {TokenDocument} doc
	 * @protected
	 */
	_tokenDocumentHasTracking(doc) {
		return !!doc.getFlag('stream-view', 'tracked');
	}

	/**
	 * The Scene Level (floor) id the local client is currently viewing
	 * within the active scene, via `Scene#_view`. `null` on scenes with no
	 * levels configured.
	 *
	 * @returns {string|null}
	 * @protected
	 */
	_currentLevelId() {
		if (!StreamView.levelsSupported) {
			return null;
		}
		return game.canvas?.scene?._view ?? null;
	}

	/**
	 * The Scene Level (floor) id whose elevation range contains the given
	 * token's elevation, looked up against `Scene#levels`.
	 *
	 * @param {Token} token
	 * @returns {string|null}
	 * @protected
	 */
	_levelIdForToken(token) {
		if (!StreamView.levelsSupported) {
			return null;
		}
		const elevation = token?.document?.elevation ?? 0;
		const level = game.canvas?.scene?.levels?.find(
			(l) => elevation >= l.elevation.bottom && elevation < l.elevation.top,
		);
		return level?.id ?? null;
	}

	/**
	 * Whether a token belongs to the currently-viewed Scene Level. Fails
	 * open (returns `true`) whenever levels aren't supported/in use, or when
	 * the token's level can't be determined.
	 *
	 * IMPORTANT: this is only appropriate for filtering *incidental* camera
	 * candidates (e.g. "which other targeted tokens should also frame into
	 * view"). It must never be applied to a token that's explicitly being
	 * followed (manually tracked, the active combatant, ...) — doing so
	 * would filter out exactly the token whose level change should instead
	 * trigger a level *switch*. See {@link _levelIdForToken}/`#targetLevel`
	 * in stream.js for that case.
	 *
	 * @param {Token} token
	 * @returns {boolean}
	 * @protected
	 */
	_tokenOnCurrentLevel(token) {
		if (!StreamView.levelsSupported) {
			return true;
		}
		const currentLevel = this._currentLevelId();
		if (currentLevel == null) {
			return true;
		}
		const tokenLevel = this._levelIdForToken(token);
		return tokenLevel == null || tokenLevel === currentLevel;
	}

	/**
	 * Synthesizes a {@link Coord} from the local client's current canvas
	 * pivot/scale/level, for cases (entering directed mode, combat starting)
	 * where a directed pan needs sending without an existing `canvasPan`
	 * event to piggyback on.
	 *
	 * @returns {Coord}
	 * @protected
	 */
	_currentViewCoord() {
		return {
			x: canvas.stage.pivot.x,
			y: canvas.stage.pivot.y,
			scale: canvas.stage.scale.x,
			level: this._currentLevelId(),
		};
	}

	/**
	 * @param {Coord} view
	 * @private
	 */
	async #sendDirectedPan(view) {
		if (!this.isCameraDirected || !this.#socket) {
			return;
		}

		try {
			await this.#socket.executeAsUser(
				'animateTo',
				game.settings.get('stream-view', 'user-id'),
				view,
			);
		} catch { }
	}

	/**
	 * @param {JQuery<HTMLElement>|HTMLElement} html
	 * @private
	 */
	#hideStreamAVUser(html) {
		if (game.settings.get('stream-view', 'voice-video-hide-stream-user')) {
			const streamCamera = toElement(html).querySelector(
				`div[data-user="${game.settings.get('stream-view', 'user-id')}"]`,
			);
			if (streamCamera) {
				streamCamera.style.display = 'none';
			}
		}
	}

	/**
	 * @private
	 */
	#handleCanvasReady() {
		this.#updateSceneAndLevel()
	}

	/**
	 * @param {TokenDocument} doc
	 * @private
	 */
	#handleTrackedTokensUpdate(doc) {
		if (this._tokenDocumentHasTracking(doc)) {
			this._trackedTokens.get(this._trackedTokensKey).add(doc.id);
		} else {
			this._trackedTokens.get(this._trackedTokensKey).delete(doc.id);
		}
	}

	/**
	 * @param {Token} token
	 * @private
	 */
	#handleTrackedTokensDelete(token) {
		this._trackedTokens.get(this._trackedTokensKey).delete(token.id);
	}

	/**
	 * @private
	 */
	#updateSceneAndLevel() {
		if (!game.canvas?.scene) {
			return;
		}

		const newSceneId = game.canvas.scene.id;
		const newLevelId = this._currentLevelId();
		if (this.#sceneId === newSceneId && this.#levelId === newLevelId) {
			return;
		}

		this.#sceneId = newSceneId;
		this.#levelId = newLevelId;

		if (!this._trackedTokens.get(this._trackedTokensKey)) {
			this._trackedTokens.set(this._trackedTokensKey, new Set());
		}
		game.canvas.tokens.placeables.forEach((t) => {
			if (this._tokenDocumentHasTracking(t.document) && this._tokenOnCurrentLevel(t)) {
				this._trackedTokens.get(this._trackedTokensKey).add(t.id);
			}
		});
	}
}