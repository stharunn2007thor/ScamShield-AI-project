const http = require("http");

const TOTAL_REQUESTS = 100;

let completed = 0;

for (let i = 0; i < TOTAL_REQUESTS; i++) {
  const request = http.get("http://localhost:3000/health", (response) => {
    response.on("data", () => {});

    response.on("end", () => {
      completed++;

      if (completed === TOTAL_REQUESTS) {
        console.log(`Completed ${completed} requests`);
      }
    });
  });

  request.on("error", () => {
    completed++;

    if (completed === TOTAL_REQUESTS) {
      console.log(`Completed ${completed} requests`);
    }
  });
}
