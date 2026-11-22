const { Pool } = require("pg");
const { createApp } = require("./app");
const { createStore } = require("./store");
const { createServiceClient } = require("./service-client");
const { ApiError } = require("./errors");

function createRuntimeApp(env = process.env) {
  let pool;
  function connection() {
    if (!env.DATABASE_URL)
      throw new ApiError(
        503,
        "DATABASE_UNAVAILABLE",
        "The database is not configured.",
      );
    if (!pool) {
      pool = new Pool({
        connectionString: env.DATABASE_URL,
        connectionTimeoutMillis: 5000,
        max: 4,
        allowExitOnIdle: true,
        statement_timeout: 8000,
      });
      pool.on("error", () =>
        console.error(
          JSON.stringify({
            service: "profile",
            event: "idle_database_connection_error",
          }),
        ),
      );
    }
    return pool;
  }
  const db = {
    query: (sql, args) => connection().query(sql, args),
    async transaction(operation) {
      const client = await connection().connect();
      try {
        await client.query("BEGIN");
        const result = await operation(client);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  };
  return createApp({
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
  });
}
module.exports = { createRuntimeApp };
