import readline from 'readline';
import chalk from 'chalk';
import { ProgressBar, overallProgressBar } from './progress-bar';

export interface SpinnerBarOptions {
    text?: string;
    spinner?: string[];
    interval?: number;
    newInstance?: boolean;
}

export class CustomSpinnerBar {
    private static instance: CustomSpinnerBar | null = null;
    private text!: string;
    private spinner!: string[];
    private interval!: number;
    private stream!: NodeJS.WriteStream;
    private frameIndex!: number;
    private isSpinning!: boolean;
    private spinnerInterval!: NodeJS.Timeout | null;
    private progressBar!: ProgressBar;
    private lastRenderTime: number = 0;
    private renderThrottleTime: number = 50; // Throttle render updates to 50ms

    constructor(options: SpinnerBarOptions = {}) {
        if (!options.newInstance && CustomSpinnerBar.instance) {
            return CustomSpinnerBar.instance;
        }
        
        if (!options.newInstance) {
            CustomSpinnerBar.instance = this;
        }

        this.text = options.text || "Loading";
        this.spinner = options.spinner || [
            "⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏",
        ];
        this.interval = options.interval || 80;
        this.stream = process.stderr;
        this.frameIndex = 0;
        this.isSpinning = false;
        this.spinnerInterval = null;
        this.progressBar = new ProgressBar();
    }

    start(text?: string): this {
        if (global.verbose) return this;
        if (text) this.text = text;
        this.isSpinning = true;
        this.frameIndex = 0;
        this.resetProgressBar();
        this.progressBar.start();
        this.render();
        this.spinnerInterval = setInterval(() => this.render(), this.interval);
        return this;
    }

    stop(): this {
        if (global.verbose) return this;
        this.isSpinning = false;
        if (this.spinnerInterval) {
            clearInterval(this.spinnerInterval);
        }
        this.spinnerInterval = null;
        return this;
    }

    succeed(text?: string): this {
        if (global?.verbose) return this;
        this.stop();

        this.progressBar.setProgress(this.progressBar.total);

        readline.clearLine(this.stream, 0);
        readline.cursorTo(this.stream, 0);

        let output = `${chalk.green("✔")} ${text || this.text}`;
        // output += " " + this.progressBar.render();

        this.stream.write(`${output}\n`);
        return this;
    }

    fail(text?: string): this {
        if (global.verbose) return this;
        this.stop();
        
        readline.clearLine(this.stream, 0);
        readline.cursorTo(this.stream, 0);
        
        let finalText = text || this.text;
        if(global.logDirectory){
            finalText += chalk.gray(" Check logs at: ") + chalk.cyan(global.logDirectory);
        }
        this.stream.write(`${chalk.red('✖')} ${chalk.bold.red(finalText)}\n`);
        process.exit(1);
    }

    info(text?: string): this {
        if (global.verbose) return this;
        this.stop();
        
        readline.clearLine(this.stream, 0);
        readline.cursorTo(this.stream, 0);
        
        this.stream.write(`${chalk.blue("ℹ")} ${text || this.text}\n`);
        return this;
    }

    warn(text?: string): this {
        if (global.verbose) return this;
        this.stop();
        
        readline.clearLine(this.stream, 0);
        readline.cursorTo(this.stream, 0);
        
        this.stream.write(`${chalk.yellow("⚠")} ${text || this.text}\n`);
        return this;
    }

    render(): void {
        if (global.verbose) return;
        
        const now = Date.now();
        if (now - this.lastRenderTime < this.renderThrottleTime) {
            return;
        }
        this.lastRenderTime = now;
        
        readline.clearLine(this.stream, 0);
        readline.cursorTo(this.stream, 0);
    
        const frame = this.spinner[this.frameIndex] || '';
        const progressBar = this.progressBar?.render() || '';
        
        let output = `${chalk.cyan(frame)} ${this.text} ${progressBar}`;
        
        if (overallProgressBar.status()) {
            const overallProgress = overallProgressBar.render();
            if (overallProgress) {
                output += ` | ${overallProgress}`;
            }
        }
        
        this.stream.write(output);
        this.frameIndex = (this.frameIndex + 1) % this.spinner.length;
    }
    
    setText(text: string): this {
        this.text = text;
        return this;
    }

    resetProgressBar(startValue: number = 0): this {
        this.progressBar.value = Math.min(Math.max(0, startValue), this.progressBar.total);
        this.progressBar.startTime = Date.now();
        return this;
    }

    setProgress(value: number): this {
        this.progressBar.setProgress(value);
        if (overallProgressBar.status()) {
            overallProgressBar.setProgress(value);
        }
        return this;
    }

    incrementProgress(amount: number = 1): this {
        this.progressBar.incrementProgress(amount);
        if (overallProgressBar.status() && overallProgressBar.value < overallProgressBar.total) {
            overallProgressBar.incrementProgress(amount);
        }
        return this;
    }

    setTotal(total: number): this {
        this.progressBar.setTotal(total);
        return this;
    }

    enableProgressBar(): this {
        this.progressBar.enable();
        return this;
    }

    disableProgressBar(): this {
        this.progressBar.disable();
        return this;
    }
}

export const spinnerBar = new CustomSpinnerBar();
export const createNewSpinnerBar = (options: SpinnerBarOptions) => new CustomSpinnerBar({ ...options, newInstance: true });
