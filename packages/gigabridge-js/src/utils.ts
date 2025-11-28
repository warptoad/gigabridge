export function sleep(time: number) {
    return new Promise(resolve => setTimeout(resolve, time));
}

/**
 * delay in ms
 * @param param0 
 */
export async function tryTillWorks(
    { func, inputs, delay = 1000, attempts = Infinity }:
        { func: Function, inputs: any[], attempts?: number, delay?: number }) {
    for (let index = 0; index < attempts; index++) {
        try {
            const result = await func(...inputs)
            return result
        } catch (error) {
            await sleep(delay)
        }
    }
}