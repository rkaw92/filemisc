function delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

const initialDelayMs = 125;
const maxDelayMs = 30000;

export async function retry<TResolve>(
    func: () => Promise<TResolve>,
    handleError: (err: unknown) => void = () => {}
) {
    let success = false;
    let delayMs = initialDelayMs;
    let result: TResolve;
    while (!success) {
        try {
            result = await func();
            success = true;
        } catch (error) {
            handleError(error);
            await delay(delayMs);
            delayMs = Math.min(delayMs * 2, maxDelayMs);
        }
    }
    return result!;
}
