// npm only ships a LICENSE that lives inside the package folder; copy the root one in before packing.
import { copyFileSync } from "node:fs";

copyFileSync(new URL("../LICENSE", import.meta.url), "LICENSE");
