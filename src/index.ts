import { buildServer } from "./server.js";
import { createFirestoreStorage } from "./storage.js";

const PORT = Number(process.env.PORT || 8080);
const AUTH_TOKEN = process.env.AUTH_TOKEN || "CHANGE_ME";
const COLLECTION_ENTRIES = process.env.COLLECTION_ENTRIES || "entries";
const COLLECTION_TOTALS = process.env.COLLECTION_TOTALS || "daily_totals";

const storage = createFirestoreStorage(COLLECTION_ENTRIES, COLLECTION_TOTALS);

const app = buildServer({
  authToken: AUTH_TOKEN,
  storage
});

app.listen({ port: PORT, host: "0.0.0.0" }, (err) => {
  if (err) {
    app.log.error(err, "server start failed");
    process.exit(1);
  }
  app.log.info(`server listening on ${PORT}`);
});
