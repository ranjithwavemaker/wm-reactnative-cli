import chalk from 'chalk';
import readline from 'readline';

export interface ProgressBarOptions {
    showProgressBar?: boolean;
    barCompleteChar?: string;
    barIncompleteChar?: string;
    barWidth?: number;
    barFormat?: string;
    total?: number;
    completeColor?: keyof typeof chalk;
    incompleteColor?: keyof typeof chalk;
    textColor?: keyof typeof chalk;
}

export class ProgressBar {
    showProgressBar: boolean;
    barCompleteChar: string;
    barIncompleteChar: string;
    barWidth: number;
    barFormat: string;
    total: number;
    value: number;
    startTime: number | null;
    completeColor: keyof typeof chalk | null;
    incompleteColor: keyof typeof chalk | null;
    textColor: keyof typeof chalk | null;
    private lastRenderedValue: number;
    private lastRenderedPercentage: number;

    constructor(options: ProgressBarOptions = {}) {
        this.showProgressBar = options.showProgressBar || false;
        this.barCompleteChar = options.barCompleteChar || '█';
        this.barIncompleteChar = options.barIncompleteChar || '░';
        this.barWidth = options.barWidth || 20;
        this.barFormat = options.barFormat || '[{bar}] {percentage}%';
        this.total = options.total || 100;
        this.value = 0;
        this.startTime = null;
        this.completeColor = options.completeColor || null;
        this.incompleteColor = options.incompleteColor || null;
        this.textColor = options.textColor || null;
        this.lastRenderedValue = -1;
        this.lastRenderedPercentage = -1;
    }

    start(): void {
        this.startTime = Date.now();
    }

    setProgress(value: number): void {
        this.value = Math.min(Math.max(0, value), this.total);
    }

    incrementProgress(amount: number = 1): void {
        this.setProgress(Math.min(this.value + amount, this.total));
    }

    setTotal(total: number): void {
        this.total = total;
    }

    enable(): void {
        this.showProgressBar = true;
    }

    disable(): void {
        this.showProgressBar = false;
    }

    status(): boolean {
        return this.showProgressBar;
    }

    calculateETA(): string {
        if (!this.startTime || this.value === 0) return '?';
        const elapsedTime = (Date.now() - this.startTime) / 1000;
        const itemsPerSecond = this.value / elapsedTime;
        const eta = Math.round((this.total - this.value) / itemsPerSecond);
        return isFinite(eta) ? eta.toString() : '?';
    }

    render(): string {
        if (!this.showProgressBar) return '';
        const percentage = Math.floor((this.value / this.total) * 100);
        
        // Skip rendering if nothing changed
        if (this.value === this.lastRenderedValue && percentage === this.lastRenderedPercentage) {
            return this.formatProgressBar(percentage);
        }
        
        this.lastRenderedValue = this.value;
        this.lastRenderedPercentage = percentage;
        
        return this.formatProgressBar(percentage);
    }
    
    private formatProgressBar(percentage: number): string {
        const completeLength = Math.round((this.value / this.total) * this.barWidth);
        const incompleteLength = this.barWidth - completeLength;
        
        let completeBar = this.barCompleteChar.repeat(completeLength);
        let incompleteBar = this.barIncompleteChar.repeat(incompleteLength);
        
        if (this.completeColor) {
            const colorFn = chalk[this.completeColor] as (text: string) => string;
            completeBar = colorFn(completeBar);
        }
        if (this.incompleteColor) {
            const colorFn = chalk[this.incompleteColor] as (text: string) => string;
            incompleteBar = colorFn(incompleteBar);
        }
        
        let bar = completeBar + incompleteBar;
        let formattedText = this.barFormat
            .replace('{bar}', bar)
            .replace('{percentage}', percentage.toString())
            .replace('{value}', this.value.toString())
            .replace('{total}', this.total.toString())
            .replace('{eta}', this.calculateETA());
        
        if (this.textColor) {
            const colorFn = chalk[this.textColor] as (text: string) => string;
            formattedText = colorFn(formattedText);
        }

        return formattedText;
    }
}

export const overallProgressBar = new ProgressBar({
    showProgressBar: false,
    barWidth: 40,
    completeColor: 'green',
    incompleteColor: 'gray',
    textColor: 'cyan'
});