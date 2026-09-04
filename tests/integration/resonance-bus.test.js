import { createMemoryResonanceBus } from '../../packages/resonance/src/resonance-bus.js';
import { runResonanceBusContract } from '../support/resonance-bus-contract.js';

// The in-memory bus is the reference implementation of the resonance contract.
// The Redis bus runs this same suite in redis-resonance-bus.test.js.
runResonanceBusContract({
  label: 'memory resonance bus',
  createBus: () => createMemoryResonanceBus(),
});
