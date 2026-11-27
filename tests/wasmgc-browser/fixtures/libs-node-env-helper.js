export function mode() { var env = process.env.NODE_ENV; return env !== "production" ? "development:" + (env === undefined ? "unset" : env) : "production"; }
