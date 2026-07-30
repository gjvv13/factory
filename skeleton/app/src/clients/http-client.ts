export interface HttpClientOptions {
  readonly baseUrl: string;
  readonly timeoutMs?: number;
  readonly defaultHeaders?: Readonly<Record<string, string>>;
}

export class HttpRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = 'HttpRequestError';
  }
}

export class HttpTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Verzoek duurde langer dan ${String(timeoutMs)}ms`);
    this.name = 'HttpTimeoutError';
  }
}

export interface HttpClient {
  getJson<T>(path: string, headers?: Record<string, string>): Promise<T>;
}

/**
 * Eén plek voor uitgaande HTTP-calls: timeout, foutafhandeling en JSON-parsing
 * horen niet in elke integratie opnieuw te worden bedacht. Het gedrag van deze
 * client is vastgelegd met contract tests (app/test/contract).
 */
export function createHttpClient(options: HttpClientOptions): HttpClient {
  const timeoutMs = options.timeoutMs ?? 5000;

  return {
    getJson: async <T>(path: string, headers: Record<string, string> = {}): Promise<T> => {
      const url = new URL(path, options.baseUrl);
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
      }, timeoutMs);

      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: { accept: 'application/json', ...options.defaultHeaders, ...headers },
          signal: controller.signal,
        });
        const text = await response.text();
        if (!response.ok) {
          throw new HttpRequestError(
            `GET ${url.pathname} gaf status ${String(response.status)}`,
            response.status,
            text,
          );
        }
        return JSON.parse(text) as T;
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          throw new HttpTimeoutError(timeoutMs);
        }
        throw error;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
