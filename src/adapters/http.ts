export type HttpRequest = {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
};

export type HttpResponse = {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
};

export type Http = (request: HttpRequest) => Promise<HttpResponse>;

type RetryOptions = { readonly sleep: (milliseconds: number) => Promise<void>; readonly maxRetries: number };

const TOO_MANY_REQUESTS = 429;
const DEFAULT_WAIT_SECONDS = 5;

const waitSeconds = (response: HttpResponse): number => {
  const indicated = Number(response.headers['retry-after']);
  return Number.isFinite(indicated) ? indicated : DEFAULT_WAIT_SECONDS;
};

export const withRateLimitRetry = (http: Http, { sleep, maxRetries }: RetryOptions): Http => {
  const attempt = async (request: HttpRequest, retriesLeft: number): Promise<HttpResponse> => {
    const response = await http(request);
    if (response.status !== TOO_MANY_REQUESTS || retriesLeft === 0) return response;
    await sleep(waitSeconds(response) * 1000);
    return attempt(request, retriesLeft - 1);
  };
  return (request) => attempt(request, maxRetries);
};

export const createFetchHttp = (): Http => async ({ method, url, headers, body }) => {
  const response = await fetch(url, { method, headers, body: body ?? null });
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body: await response.text(),
  };
};
