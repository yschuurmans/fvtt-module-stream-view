/**
 * @typedef Dimensions
 * @property {number} width
 * @property {number} height
 */

/**
 * @typedef {object} Coord
 * @property {number} x
 * @property {number} y
 * @property {number} scale
 * @property {string|number|null} [level] - Active Scene Level identifier (v14+ native Scene Levels only; absent/null pre-v14 or on scenes without levels)
 */

/**
 * @typedef {object} Speaker
 * @property {boolean} isSpeaking
 * @property {Token} token
 * @property {number} last
 */

/**
 * @typedef {object} SpeakerHistory
 * @property {Speaker} current
 * @property {Speaker} previous
 */

/**
 * @typedef {Object} LayerPreview
 * @property {number} x
 * @property {number} y
 * @property {number} width
 * @property {number} height
 */

/**
 * @typedef {Object} PopoutOptions
 * @property {number} width
 * @property {number} height
 * @property {number} left
 * @property {number} top
 * @property {number} scale
 * @property {number} zIndex
 */