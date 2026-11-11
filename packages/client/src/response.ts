// HTTP failures have the same meaning for JSON requests and failed SSE handshakes.
export const responseError = async (response: Response): Promise<Error & { code?: string }> => {
  const text = await response.text()
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    /* A proxy can return plain text instead of the server envelope. */
  }
  const error: Error & { code?: string } = new Error(
    body && typeof body === "object" && "error" in body && typeof body.error === "string"
      ? body.error
      : text.trim() || `HTTP ${response.status}`,
  )
  if (body && typeof body === "object" && "code" in body && typeof body.code === "string") error.code = body.code
  return error
}
export const responseValue = async <T>(response: Response): Promise<T> => {
  if (!response.ok) throw await responseError(response)
  try {
    return (await response.json()) as T
  } catch {
    throw new Error(`HTTP ${response.status}: invalid JSON`)
  }
}
