const fs = require('fs');
const os = require('os');
import axios from 'axios';
import prompt from 'prompt';
const { exec } = require('./exec');
const extract = require('extract-zip');

export function isWindowsOS() {
    return (os.platform() === "win32" || os.platform() === "win64");
}

export async function readAndReplaceFileContent(path: string, writeFn: (content: string) => string) {
    const content = fs.readFileSync(path, 'utf-8');
    return Promise.resolve().then(() => {    
        return writeFn && writeFn(content);
    }).then((modifiedContent) => {
        if (modifiedContent !== undefined && modifiedContent !== null) {
            fs.writeFileSync(path, modifiedContent);
            return modifiedContent;
        }
        return content;
    });
}

export function streamToString(stream: any): Promise<string> {
    const chunks: any[] = [];
    return new Promise<string>((resolve, reject) => {
      stream.on('data', (chunk: any) => chunks.push(Buffer.from(chunk)));
      stream.on('error', (err: any) => reject(err));
      stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
}

export async function iterateFiles(path: string,  callBack: (path: string) => Promise<void>) {
    if (fs.lstatSync(path).isDirectory()) {
        await Promise.all(fs.readdirSync(path).map((p: string) => iterateFiles(`${path}/${p}`, callBack)));
    } else {
        await callBack && callBack(path);
    }
}

export async function showConfirmation(message: string) {
    return new Promise((resolve, reject) => {
        prompt.get({
            properties: {
                confirm: {
                    pattern: /^(yes|no|y|n)$/gi,
                    description: message,
                    message: 'Type yes/no',
                    required: true,
                    default: 'no'
                }
            }
        }, function (err: any, result: any) {
            if (err) {
                reject();
            }
            resolve(result.confirm.toLowerCase());
        });
    });
}

export async function unzip(src: string, dest: string) {
    if ( isWindowsOS() ) {
        await extract(src, { dir: dest});
    } else {
        await exec('unzip', [
            '-o', src, '-d', dest
        ], {
            log: false
        });
    }
}


export async function isExpoWebPreviewContainer(previewUrl:string) {
    const response = await axios.get(`${previewUrl}/rn-bundle/index.html`).catch((e) => e.response);
    return response.data.includes("index.bundle") && response.data.includes("platform=web");
}