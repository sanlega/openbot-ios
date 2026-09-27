/** Returns true when the local Docker daemon responds to ping. */
export async function isDockerAvailable(): Promise<boolean> {
  try {
    const Docker = (await import("dockerode")).default;
    const docker = new Docker();
    await docker.ping();
    return true;
  } catch {
    return false;
  }
}
