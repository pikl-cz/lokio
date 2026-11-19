import { describeAdapterConformance } from "./conformance.js";
import { MemoryAdapter } from "./memory-adapter.js";

describeAdapterConformance("MemoryAdapter", () => new MemoryAdapter());
