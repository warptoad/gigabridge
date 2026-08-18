import { ReadonlyLeanIMT } from "@warptoad/skinny-fat-imt-js";
import { LeanIMT } from "@zk-kit/lean-imt";

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

/* cant just destructure LeanIMT object because of `get` getters, so i do this so i can have a LeanIMT tree + extra functions like .sync */
export function treeWith<E extends object>(tree: LeanIMT<bigint>, extra: E): ReadonlyLeanIMT & E {
    return Object.assign(Object.create(tree) as LeanIMT<bigint>, extra)
}