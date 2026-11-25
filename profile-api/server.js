const app = require("./app");

const port = Number(process.env.PORT ?? 3001);
const server = app.listen(port, "127.0.0.1", () => {
  console.log(
    `Profile and Privacy API available at http://localhost:${server.address().port}`,
  );
});
