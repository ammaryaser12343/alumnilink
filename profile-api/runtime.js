const { createDatabase } = require("./services/db");
const { createStore } = require("./services/profileStore");
const { createServiceClient } = require("./services/serviceClient");

function createRuntimeOptions(env = process.env) {
  const db = createDatabase(env);
  return {
    store: createStore(db),
    identity: createServiceClient({
      baseUrl: env.IDENTITY_API_URL,
      serviceKey: env.SERVICE_KEY,
      service: "Identity",
    }),
    locations: createServiceClient({
      baseUrl: env.SEARCH_API_URL,
      serviceKey: env.SERVICE_KEY,
      service: "Locations",
    }),
    config: {
      serviceKey: env.SERVICE_KEY,
      frontendOrigin: env.FRONTEND_ORIGIN,
    },
  };
}
module.exports = { createRuntimeOptions };
