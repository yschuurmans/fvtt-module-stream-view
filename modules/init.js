import { StreamViewOptions } from './options.js';
import { StreamView } from './stream_view.js';
import { StreamViewGM } from './gm.js';
import { StreamViewStream } from './stream.js';
import { StreamViewPlayer } from './player.js';

class StreamViewInit {
	/**
	 * @type {Socketlib}
	 * @private
	 */
	static #socket;

	static start() {
		Hooks.once('init', () => StreamViewInit.init());
		Hooks.once('socketlib.ready', () => StreamViewInit.initSocket());
		Hooks.once('setup', () => StreamViewInit.setup());
	}

	static init() {
		StreamViewOptions.init();
	}

	static initSocket() {
		this.#socket = socketlib.registerModule('stream-view');
	}

	static setup() {
		const user = game.user;
		const isGM = game.user.isGM;
		if (isGM) {
			const gm = new StreamViewGM(this.#socket);
			Hooks.once('ready', () => StreamViewOptions.ready(gm));
			gm.setup();
		} else if (user.id === game.settings.get('stream-view', 'user-id')) {
			const stream = new StreamViewStream(this.#socket);
			Hooks.once('ready', () => StreamViewOptions.ready(stream));
			stream.setup();
		} else {
			const player = new StreamViewPlayer(this.#socket);
			Hooks.once('ready', () => StreamViewOptions.ready(player));
			player.setup();
		}
	}
}

StreamViewInit.start();
