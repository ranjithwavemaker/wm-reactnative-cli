import execa from 'execa';
import logger from './logger';
import { message } from 'prompt';

const loggerLabel = 'exec';

interface OutputPipeOptions {
    bufferSize?: number;
    log?: boolean;
    loggerLabel: string;
}

function isErrorWithoutWarning(v: string) {
    const lowerV = v.toLowerCase();
    return lowerV.includes("error") && (!lowerV.includes("warning") && !lowerV.includes("warn"));
}

class OutputPipe {
    private output: string;
    public content: string[];
    private bufferSize: number;
    private logOutput: boolean;
    private loggerLabel: string;

    constructor({ bufferSize = 100, log , loggerLabel }: OutputPipeOptions) {
        this.output = '';
        this.content = [];
        this.bufferSize = bufferSize;
        this.logOutput = (log !== false);
        this.loggerLabel = loggerLabel;
    }

    private log(str: string, isErrorType: boolean): string {
        let reminder = '';
        str.split('\n').forEach((v, i, splits) => {
            if (i < splits.length - 1) {
                v && (this.logOutput || isErrorType) && (isErrorType && isErrorWithoutWarning(v) ? logger.error({label: this.loggerLabel, message: v}) : logger.debug({label: this.loggerLabel, message: v}));
                if (this.content.length > this.bufferSize) {
                    this.content.shift();
                }
                this.content.push(v);
            } else {
                reminder = v;
            }
        });
        return reminder;
    }

    push(str: string, isErrorType: boolean = false): void {
        if (str) {
            this.output = this.log(this.output + str, isErrorType) || '';
        }
    }

    flush(): void {
        this.log(this.output + '\n', false);
    }
}

export const exec = (cmd: string, args: string[] = [], options: any = {}): Promise<string[]> => {
    logger.info({
        label: loggerLabel,
        message: `
        \x1b[1;34m    ╔════════════════════════════════════╗
            ║ Executing: ${cmd} ${(args && args.join(' '))}
            ╚════════════════════════════════════╝\x1b[0m
            `
    });
    
    const outputPipe = new OutputPipe({
        bufferSize: 100,
        log: options && options.log,
        loggerLabel: cmd.slice(cmd.lastIndexOf('/') + 1)
    });

    const spawn = execa(cmd, args, { ...options, env: { ...process.env, FORCE_COLOR: '1' } });
    
    spawn.stdout?.on('data', (data: Buffer) => {
        outputPipe.push(String.fromCharCode.apply(null, Array.from(new Uint16Array(data))));
    });
    
    spawn.stderr?.on('data', (data: Buffer) => {
        outputPipe.push(String.fromCharCode.apply(null, Array.from(new Uint16Array(data))), true);
    });

    return new Promise((resolve, reject) => {
        spawn.on('close', code => {
            outputPipe.flush();
            if (code === 0) {
                resolve(outputPipe.content);
            } else {
                reject(code);
            }
        });
    });
}; 