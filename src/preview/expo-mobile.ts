import logger from '../utils/logger';
const fs = require('fs-extra');
const express = require('express');
const http = require('http');
const os = require('os');
const rimraf = require("rimraf");
const open = require('open');
const httpProxy = require('http-proxy');
const request = require('request');
const { exec } = require('../utils/exec');
const { readAndReplaceFileContent, isWindowsOS, isExpoWebPreviewContainer } = require('../utils/utils');
const crypto = require('crypto');
const { VERSIONS, hasValidExpoVersion } = require('../utils/requirements');
const axios = require('axios');
import projectSyncService from "../services/project-sync.service";
const path = require('path');
const semver = require('semver');
const taskLogger = require('../custom-logger/task-logger').spinnerBar;
const {previewSteps} = require('../utils/steps');
const chalk = require('chalk');
import { BasePreview } from './base-preview';

class ExpoMobile extends BasePreview {
    private static readonly webPreviewPort = 19005;
    private static readonly loggerLabel = 'expo-launcher';
    private proxyPort = 19009;
    private barcodePort = 19000;
    private proxyUrl: string;
    private useProxy = false;
    private expoDirectoryHash = "";
    // private rnAppPath = "";

    constructor() {
        super();
        this.proxyUrl = `http://${this.getIpAddress()}:${this.proxyPort}`;
    }

    //abstract methods
    protected getProfileName(): string {
        return 'expo-preview';
    }

    protected async updateProfileConfig(projectDir: string): Promise<void> {
        await readAndReplaceFileContent(`${this.codegen}/src/profiles/expo-preview.profile.js`, (content: string) => {
            return content.replace('copyResources: false', 'copyResources: true');
        });
    }

    protected getExpoProjectDir(projectDir: string): string {
        if (isWindowsOS()) {
            const expoDirHash = (crypto as any).createHash("shake256", { outputLength: 8 }).update(`${projectDir}/target/generated-expo-app`).digest("hex");
            this.expoDirectoryHash = expoDirHash;
            return path.resolve(`${(global as any).rootDir}/wm-preview/` + expoDirHash);
        }
        return `${projectDir}/target/generated-expo-app`;
    }

    protected getLoggerLabel(): string {
        return ExpoMobile.loggerLabel;
    }

    //methods
    private async updatePackageJsonFile(path: string) {
        let data = fs.readFileSync(path, 'utf-8');
        const jsonData = JSON.parse(data);
        if (jsonData['dependencies']['expo-file-system'] === '^15.1.1') {
            jsonData['dependencies']['expo-file-system'] = '15.2.2'
        }
        fs.writeFileSync(path, JSON.stringify(jsonData), 'utf-8');
        logger.info({
            'label': ExpoMobile.loggerLabel,
            'message': 'updated package.json file'
        });
    }

    async transpile(projectDir: string, previewUrl: string, incremental: boolean) {
        try {
            taskLogger.start(previewSteps[3].start);
            taskLogger.setTotal(previewSteps[3].total);
            await super.transpile(projectDir, previewUrl, incremental);
            const expoProjectDir = this.getExpoProjectDir(projectDir);
            const configJSONFile = `${expoProjectDir}/wm_rn_config.json`;
            const config = fs.readJSONSync(configJSONFile);
            if (this.useProxy) {
                config.serverPath = `http://${this.getIpAddress()}:${this.proxyPort}/`;
            } else {
                config.serverPath = previewUrl;
            }
            fs.writeFileSync(configJSONFile, JSON.stringify(config, null, 4));
            if (!(config.sslPinning && config.sslPinning.enabled)) {
                await readAndReplaceFileContent(`${this.getExpoProjectDir(projectDir)}/App.js`, (content: string) => {
                    return content.replace('if (isSslPinningAvailable()) {',
                        'if (false && isSslPinningAvailable()) {');
                });
            }
            logger.info({
                label: ExpoMobile.loggerLabel,
                message: `generated expo project at ${this.getExpoProjectDir(projectDir)}`
            });
            taskLogger.incrementProgress(2);
            taskLogger.succeed(previewSteps[3].succeed);
        } catch (e) {
            taskLogger.fail(previewSteps[3].fail);
            throw e;
        }
    }

    async installDependencies(projectDir: string) {
        await this.updatePackageJsonFile(this.getExpoProjectDir(projectDir) + '/package.json');
        try {
            taskLogger.start(previewSteps[4].start);
            taskLogger.setTotal(previewSteps[4].total);
            taskLogger.incrementProgress(1);
            await super.installDependencies(this.getExpoProjectDir(projectDir));
            taskLogger.incrementProgress(3);
            taskLogger.succeed(previewSteps[4].succeed);
        } catch (e) {
            taskLogger.fail(previewSteps[4].fail);
            throw e;
        }
    }

    private async setup(previewUrl: string, _clean: boolean, authToken?: string) {
        taskLogger.setTotal(previewSteps[0].total);
        taskLogger.start(previewSteps[0].start);
        taskLogger.incrementProgress(0.5);
        const projectName = await this.getProjectName(previewUrl);
        const projectDir = `${(global as any).rootDir}/wm-projects/${projectName.replace(/\s+/g, '_').replace(/\(/g, '_').replace(/\)/g, '_')}`;
        if (_clean) {
            this.clean(projectDir);
            if (isWindowsOS() && this.expoDirectoryHash) {
                const projectDirHash = `${(global as any).rootDir}/wm-preview/${this.expoDirectoryHash}`;
                this.clean(projectDirHash);
            }
        } else {
            fs.mkdirpSync(this.getWmProjectDir(projectDir));
        }
        taskLogger.incrementProgress(0.5);
        taskLogger.succeed(previewSteps[0].succeed);
        taskLogger.resetProgressBar();
        taskLogger.setTotal(previewSteps[1].total);
        const syncProject = await projectSyncService.setupProject(previewUrl, projectName, projectDir, authToken);
        await this.transpile(projectDir, previewUrl, false);
        return { projectDir, syncProject };
    }

    private updateReanimatedPlugin(projectDir: string) {
        const packageFile = `${this.getExpoProjectDir(projectDir)}/package.json`;
        const pkg = JSON.parse(fs.readFileSync(packageFile, {
            encoding: 'utf-8'
        }));
        if (pkg['dependencies']['expo'] === '48.0.18' || pkg['dependencies']['expo'] === '49.0.7') {
            let path = this.getExpoProjectDir(projectDir);
            path = path + '/node_modules/react-native-reanimated/src/reanimated2/NativeReanimated/NativeReanimated.ts';
            let content = fs.readFileSync(path, 'utf-8');
            content = content.replace(/global.__reanimatedModuleProxy === undefined/gm, `global.__reanimatedModuleProxy === undefined && native`);
            fs.writeFileSync(path, content);
        }
    }

    protected launchServiceProxy(projectDir: string, previewUrl: string) {
        taskLogger.setTotal(previewSteps[5].total);
        taskLogger.start(previewSteps[5].start);
        
        super.launchServiceProxy(projectDir, previewUrl);
        http.createServer((req: any, res: any) => {
            try {
                let tUrl = req.url;
                if (req.url === '/' || req.url.startsWith('/rn-bundle')) {
                    tUrl = `http://localhost:${ExpoMobile.webPreviewPort}${req.url}`;
                    req.pipe(request(tUrl)).pipe(res);
                } else {
                    this.proxy.web(req, res, {
                        target: previewUrl,
                        xfwd: false,
                        changeOrigin: true,
                        secure: false,
                        cookiePathRewrite: {
                            "*": ""
                        }
                    });
                    tUrl = `${previewUrl}/${req.url}`;
                }
            } catch (e) {
                res.writeHead(500);
                console.error(e);
            }
        }).listen(this.proxyPort);
        logger.info({
            label: ExpoMobile.loggerLabel,
            message: `Service proxy launched at ${this.proxyUrl} .`
        });
        taskLogger.succeed(previewSteps[5].succeed);
    }

    private async sync(previewUrl: string, clean: boolean) {
        const { projectDir, syncProject } = await this.setup(previewUrl, clean);
        this.proxyPort = 19007;
        this.proxyUrl = `http://${this.getIpAddress()}:${this.proxyPort}`;
        await this.installDependencies(projectDir);
        if (this.useProxy) {
            this.launchServiceProxy(projectDir, previewUrl);
        }
        taskLogger.succeed(chalk.green("Sync finished ") + chalk.blue(`generated expo project at : ${this.getExpoProjectDir(projectDir)}`));
        this.isExpoPreviewContainer = await isExpoWebPreviewContainer(previewUrl);
        this.watchProjectChanges(previewUrl, () => {
            const startTime = Date.now();
            syncProject()
                .then(() => {
                    logger.info({
                        label: ExpoMobile.loggerLabel,
                        message: `Sync Time: ${(Date.now() - startTime) / 1000}s.`
                    });
                    taskLogger.info(`Sync Time: ${(Date.now() - startTime) / 1000}s.`);
                }).then(() => this.transpile(projectDir, previewUrl, true))
                .then(() => {
                    logger.info({
                        label: ExpoMobile.loggerLabel,
                        message: `Total Time: ${(Date.now() - startTime) / 1000}s.`
                    });
                    taskLogger.info(`Total Time: ${(Date.now() - startTime) / 1000}s.`);
                });
        });
        this.watchForPlatformChanges(() => {
            const startTime = Date.now();
            return this.transpile(projectDir, previewUrl, false).then(() => {
                const duration = ((Date.now() - startTime) / 1000).toFixed(2);
                logger.info({
                    label: ExpoMobile.loggerLabel,
                    message: `Total Time: ${duration}s.`
                });
                taskLogger.info(`Total Time: ${duration}s.`);
            });
        });
    }

    private async runNative(previewUrl: string, platform: 'android' | 'ios', clean: boolean) {
        try {
            const { projectDir, syncProject } = await this.setup(previewUrl, clean);

            await this.installDependencies(projectDir);
            this.updateReanimatedPlugin(projectDir);
            if (this.useProxy) {
                this.launchServiceProxy(projectDir, previewUrl);
            }
            await exec('npx', ['expo', 'prebuild'], {
                cwd: this.getExpoProjectDir(projectDir)
            });
            await this.transpile(projectDir, previewUrl, false);
            await this.installDependencies(projectDir);
            if (platform === 'ios') {
                await exec('pod', ['install'], {
                    cwd: this.getExpoProjectDir(projectDir) + '/ios'
                });
            }
            await exec('npx', [
                'react-native',
                platform === 'android' ? 'run-android' : 'run-ios'
            ], {
                cwd: this.getExpoProjectDir(projectDir)
            });
            this.watchProjectChanges(previewUrl, () => {
                const startTime = Date.now();
                syncProject()
                    .then(() => {
                        logger.info({
                            label: ExpoMobile.loggerLabel,
                            message: `Sync Time: ${(Date.now() - startTime) / 1000}s.`
                        });
                    })
                    .then(() => this.transpile(projectDir, previewUrl, true))
                    .then(() => {
                        logger.info({
                            label: ExpoMobile.loggerLabel,
                            message: `Total Time: ${(Date.now() - startTime) / 1000}s.`
                        });
                    });
            });
            this.watchForPlatformChanges(() => this.transpile(projectDir, previewUrl, false));
        } catch (e) {
            logger.error({
                label: ExpoMobile.loggerLabel,
                message: e
            });
        }
    }

    public runAndroid(previewUrl: string, clean: boolean) {
        return this.runNative(previewUrl, 'android', clean);
    }

    public runIos(previewUrl: string, clean: boolean) {
        return this.runNative(previewUrl, 'ios', clean);
    }

    public syncProject(previewUrl: string, clean: boolean, _useProxy: boolean) {
        this.useProxy = _useProxy;
        return this.sync(previewUrl, clean);
    }
}

const expoMobile = new ExpoMobile();
export const runAndroid = expoMobile.runAndroid.bind(expoMobile);
export const runIos = expoMobile.runIos.bind(expoMobile);
export const sync = expoMobile.syncProject.bind(expoMobile);
export default expoMobile;