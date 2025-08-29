import util from 'util';
import { exec as execNonPromise } from 'child_process';
import { resolve } from 'path';
const exec = util.promisify(execNonPromise);

export async function compileHuff(huffContractFilePath: string) {
    const command = `huffc ${huffContractFilePath} --bytecode`

    try {
        const { stdout: bytecode, stderr } = await exec(command)
        if (stderr) { console.error(stderr) }
        return bytecode
    } catch (error) {
        throw new Error(`could not compile huff. Is huff installed? Is this file path correct? ${huffContractFilePath} ?`, { cause: error })
    }
}