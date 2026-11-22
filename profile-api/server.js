const { createRuntimeApp } = require("./runtime");

const port = Number(process.env.PORT ?? 3001);
const server = createRuntimeApp().listen(port, "127.0.0.1", () => {
  console.log(
    `Profile and Privacy API available at http://localhost:${server.address().port}`,
  );
});
