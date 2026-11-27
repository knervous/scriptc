// An ambient env interface (vite's ImportMetaEnv shape: Record<string, any>), which routes reads through the island.
interface AmbientEnv extends Record<string, any> { BASE_URL: string }
