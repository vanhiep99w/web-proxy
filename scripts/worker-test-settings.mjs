// Public, deliberately test-only values; never use these for a deployment.
export const workerTest = {
  frontendOrigin: "http://127.0.0.1:3103",
  apiOrigin: "http://127.0.0.1:3104",
  password: "abc",
  secret: "e2e-worker-secret-at-least-32-characters-not-for-deployment",
};
