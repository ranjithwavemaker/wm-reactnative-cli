import logger from '../utils/logger';
import * as fs from 'fs-extra';
import express from 'express';
import * as http from 'http';
import request from 'request';
import * as os from 'os';
import rimraf from 'rimraf';
import { default as openBrowser } from 'open';
import Server = require('http-proxy');
import { exec } from '../utils/exec';
import { readAndReplaceFileContent, isExpoWebPreviewContainer } from '../utils/utils';
import * as crypto from 'crypto';
import { VERSIONS, hasValidExpoVersion } from '../utils/requirements';
import axios from 'axios';
import * as path from 'path';
import * as semver from 'semver';
import projectSyncService from "../services/project-sync.service";
import { BasePreview } from './base-preview';
const taskLogger = require('../custom-logger/task-logger').spinnerBar;
import { esbuildWebPreviewSteps } from '../utils/steps';
import chalk from 'chalk';


export class EsBuildWeb extends BasePreview {
    private static readonly webPreviewPort = 19005;
    private static readonly loggerLabel = 'esbuild-web-preview';
    private proxyPort = 19009;
    private proxyUrl: string;
    private expoDirectoryHash = "";
    // private rnAppPath = "";

    constructor() {
        super();
        this.proxyUrl = `http://${this.getIpAddress()}:${this.proxyPort}`;
    }

    //abstract methods
    protected async updateProfileConfig(projectDir: string): Promise<void> {
        await readAndReplaceFileContent(`${this.codegen}/src/profiles/web-preview.profile.js`, (content: string) => {
            return content.replace('copyResources: false', 'copyResources: true');
        });
    }

    protected getProfileName(): string {
        return 'web-preview';
    }

    protected getLoggerLabel(): string {
        return EsBuildWeb.loggerLabel;
    }

    //methods
    protected launchServiceProxy(projectDir: string, previewUrl: string): void {
        taskLogger.setTotal(esbuildWebPreviewSteps[5].total);
        taskLogger.start(esbuildWebPreviewSteps[5].start);
        super.launchServiceProxy(projectDir, previewUrl);

        const app = express();
        app.use('/rn-bundle', express.static(this.getWmProjectDir(projectDir) + '/rn-bundle'));
        app.get("*", (req, res) => {
            res.send(`
            <html>
                <head>
                    <script type="text/javascript">
                        location.href="/rn-bundle/index.html"
                    </script>
                </head>
            </html>`);
        });
        app.listen(EsBuildWeb.webPreviewPort);

        http.createServer((req, res) => {
            try {
                let tUrl = req.url || '/';
                if (tUrl === '/' || tUrl.startsWith('/rn-bundle')) {
                    tUrl = `http://localhost:${EsBuildWeb.webPreviewPort}${tUrl}`;
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
                    tUrl = `${previewUrl}/${tUrl}`;
                }
            } catch (e) {
                res.writeHead(500);
                console.error(e);
            }
        }).listen(this.proxyPort);
                // taskLogger.incrementProgress(1);
        // taskLogger.incrementProgress(1);
        taskLogger.succeed(esbuildWebPreviewSteps[5].succeed);
        logger.info({
            label: this.getLoggerLabel(),
            message: `Service proxy launched at ${this.proxyUrl}.`
        });
    }

    private async updatePackageJsonFile(filePath: string): Promise<void> {
        const data = fs.readFileSync(filePath, 'utf-8');
        const jsonData = JSON.parse(data);
        if (jsonData['dependencies']['expo-file-system'] === '^15.1.1') {
            jsonData['dependencies']['expo-file-system'] = '15.2.2';
        }
        jsonData['dependencies']['react-native-svg'] = '13.4.0';
        fs.writeFileSync(filePath, JSON.stringify(jsonData), 'utf-8');
        logger.info({
            label: EsBuildWeb.loggerLabel,
            message: 'updated package.json file'
        });
    }

    async transpile(projectDir: string, previewUrl: string, incremental: boolean): Promise<void> {
        try {
            taskLogger.setTotal(esbuildWebPreviewSteps[3].total);
            taskLogger.start(esbuildWebPreviewSteps[3].start);
            await super.transpile(projectDir, previewUrl, incremental);
            const expoProjectDir = this.getExpoProjectDir(projectDir);
            const configJSONFile = `${expoProjectDir}/wm_rn_config.json`;
            const config = fs.readJSONSync(configJSONFile);
            config.serverPath = `${this.proxyUrl}/_`;
            fs.writeFileSync(configJSONFile, JSON.stringify(config, null, 4));


            logger.info({
                label: EsBuildWeb.loggerLabel,
                message: `generated expo project at ${this.getExpoProjectDir(projectDir)}`
            });
            taskLogger.incrementProgress(2);
            taskLogger.succeed(esbuildWebPreviewSteps[3].succeed);
        } catch (e) {
            taskLogger.fail(esbuildWebPreviewSteps[3].fail);
            throw e;
        }
    }

    async installDependencies(projectDir: string): Promise<void> {
        try {
            taskLogger.setTotal(esbuildWebPreviewSteps[4].total);
            taskLogger.start(esbuildWebPreviewSteps[4].start);
            taskLogger.incrementProgress(1);
            
            const expoProjectDir = this.getExpoProjectDir(projectDir);
            await this.updatePackageJsonFile(expoProjectDir + '/package.json');
            
            // Check if node_modules already exists and was recently created by transpilation process
            const nodeModulesPath = `${expoProjectDir}/node_modules`;
            const nodeModulesExists = fs.existsSync(nodeModulesPath);
            
            // If we don't have node_modules or we need to make sure we have the updates after package.json changes
            if (!nodeModulesExists) {
                await super.installDependencies(expoProjectDir);
                logger.info({
                    label: EsBuildWeb.loggerLabel,
                    message: 'Installed dependencies'
                });
            } else {
                // Check if we have core dependencies already
                const reactExists = fs.existsSync(`${nodeModulesPath}/react`);
                const reactNativeExists = fs.existsSync(`${nodeModulesPath}/react-native`);
                
                if (reactExists && reactNativeExists) {
                    logger.info({
                        label: EsBuildWeb.loggerLabel,
                        message: 'Dependencies already exist, skipping npm install'
                    });
                } else {
                    await super.installDependencies(expoProjectDir);
                    logger.info({
                        label: EsBuildWeb.loggerLabel,
                        message: 'Installed missing dependencies'
                    });
                }
            }
            
            taskLogger.incrementProgress(3);
            taskLogger.succeed(esbuildWebPreviewSteps[4].succeed);
        } catch (e) {
            taskLogger.fail(esbuildWebPreviewSteps[4].fail);
            throw e;
        }
    }

    protected getExpoProjectDir(projectDir: string): string {
        return `${projectDir}/target/generated-rn-web-app`;
    }

    private async setup(previewUrl: string, _clean: boolean, authToken: string) {
        const projectName = await this.getProjectName(previewUrl);
        const projectDir = `${global.rootDir}/wm-projects/${projectName.replace(/\s+/g, '_').replace(/\(/g, '_').replace(/\)/g, '_')}`;
        if (_clean) {
            this.clean(projectDir);
        } else {
            fs.mkdirpSync(this.getWmProjectDir(projectDir));
        }
        const syncProject = await projectSyncService.setupProject(previewUrl, projectName, projectDir, authToken);
        await this.transpile(projectDir, previewUrl, false);
        return { projectDir, syncProject };
    }


    public async run(previewUrl: string, clean: boolean, authToken: string): Promise<void> {
        try {
            const { projectDir, syncProject } = await this.setup(previewUrl, clean, authToken);
            await this.installDependencies(projectDir);
            this.isExpoPreviewContainer = await isExpoWebPreviewContainer(previewUrl);
            this.launchServiceProxy(projectDir, previewUrl);
            
            this.watchProjectChanges(previewUrl, () => {
                const startTime = Date.now();
                syncProject()
                .then(() => {
                    logger.info({
                        label: EsBuildWeb.loggerLabel,
                        message: `Sync Time: ${(Date.now() - startTime)/ 1000}s.`
                    });
                    taskLogger.info(`Sync Time: ${(Date.now() - startTime)/ 1000}s.`);
                })
                .then(() => this.transpile(projectDir, previewUrl, true))
                .then(() => {
                    logger.info({
                        label: EsBuildWeb.loggerLabel,
                        message: `Total Time: ${(Date.now() - startTime)/ 1000}s.`
                    });
                    taskLogger.info(`Total Time: ${(Date.now() - startTime)/ 1000}s.`);
                });
            });
            
            this.watchForPlatformChanges(() => this.transpile(projectDir, previewUrl, false));
            taskLogger.info(`generated esbuild web app at ${projectDir}`);
            taskLogger.succeed(chalk.green("Esbuild finished ") + chalk.blue(`Service proxy launched at ${this.proxyUrl}`));
        } catch (e) {
            logger.error({
                label: EsBuildWeb.loggerLabel,
                message: e
            });
            taskLogger.fail(e);
        }
    }
}

const esbuildWeb = new EsBuildWeb();
export const runESBuildWebPreview = esbuildWeb.run.bind(esbuildWeb);
export default esbuildWeb;