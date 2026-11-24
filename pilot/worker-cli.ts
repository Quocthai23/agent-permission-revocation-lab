import { PilotStore } from "./store.js";
import { dispatchOnce } from "./dispatcher.js";

const { PILOT_DATABASE, PILOT_URL, PILOT_TOKEN } = process.env;
if (!PILOT_DATABASE || !PILOT_URL || !PILOT_TOKEN)
  throw new Error("set PILOT_DATABASE, PILOT_URL and PILOT_TOKEN");
const store = new PilotStore(PILOT_DATABASE);
try { console.log(await dispatchOnce(store, PILOT_URL, PILOT_TOKEN)); }
finally { store.close(); }
