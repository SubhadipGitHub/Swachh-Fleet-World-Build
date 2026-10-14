// The generator lives in shared/ so routing (below sim in the layer order, AD-2) can seed its own searches.
export { STREAM_NAMES, createStreams, rngFromSeed, rngFromState, type Rng, type RngState, type StreamName } from '../shared/rng';
