import * as fs from 'fs-extra';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import * as rimraf from 'rimraf';
import * as semver from 'semver';
import { createProxyServer, ServerOptions } from 'http-proxy';
import axios from 'axios';
import request from 'request';
import { exec } from '../utils/exec';
import { readAndReplaceFileContent, streamToString, isExpoWebPreviewContainer } from '../utils/utils';
import projectSyncService from "../services/project-sync.service";
import logger from '../utils/logger';
import { BasePreview } from './base-preview';
import { expoWebPreviewSteps } from '../utils/steps';
const taskLogger = require('../custom-logger/task-logger').spinnerBar;
import chalk from 'chalk';

export class ExpoWeb extends BasePreview {
    public static readonly webPreviewPort = 19006;
    public proxyPort = 19009;
    private static readonly loggerLabel = 'expo-launcher';
    basePath = '/rn-bundle/';

    private proxyUrl: string = '';
    private expoVersion: string = '';

    constructor() {
        super();
        this.proxyUrl = `http://localhost:${this.proxyPort}`;
    }

    //abstract methods
    protected async updateProfileConfig(projectDir: string): Promise<void> {
        await readAndReplaceFileContent(path.resolve(`${this.codegen}/src/profiles/expo-preview.profile.js`), (content: string) => {
            return content.replace('copyResources: true', 'copyResources: false');
        });
    }

    protected getProfileName(): string {
        // Check for specific expo-web-preview profile, otherwise fallback to expo-preview
        if (fs.existsSync(path.resolve(`${this.codegen}/src/profiles/expo-web-preview.profile.js`))) {
            return 'expo-web-preview';
        }
        return 'expo-preview';
    }

    protected getExpoProjectDir(projectDir: string): string {
        return `${projectDir}/target/generated-expo-web-app`;
    }

    protected getLoggerLabel(): string {
        return ExpoWeb.loggerLabel;
    }

    //methods
    protected launchServiceProxy(projectDir: string, previewUrl: string): void {
        taskLogger.setTotal(expoWebPreviewSteps[7].total);
        taskLogger.start(expoWebPreviewSteps[7].start);
        super.launchServiceProxy(projectDir, previewUrl);
        http.createServer((req, res) => {
            try {
                let tUrl = req.url || '';
                if (req.url?.startsWith(this.basePath)) {
                    tUrl = tUrl.replace(this.basePath, '');
                }
                tUrl = (tUrl.startsWith('/') ? '' : '/') + tUrl;
                tUrl = `http://localhost:${ExpoWeb.webPreviewPort}${tUrl}`;

                if (req.url?.endsWith('index.html')) {
                    axios.get(tUrl).then(body => {
                        res.end(body.data.replace('/index.bundle?', `./index.bundle?minify=true&`));
                    });
                    return;
                }

                if (req.url === '/') {
                    res.writeHead(302, { 'Location': `${this.basePath}index.html` });
                    res.end();
                } else if (req.url?.startsWith(this.basePath + '_/_') || req.url?.startsWith(this.basePath + '_')) {
                    req.url = req.url.replace(this.basePath + '_/_', '').replace(this.basePath + '_', '');
                    this.proxy.web(req, res, {
                        target: previewUrl,
                        secure: false,
                        xfwd: false,
                        changeOrigin: true,
                        cookiePathRewrite: { "*": "" }
                    });
                } else {
                    req.headers.origin = `http://localhost:${ExpoWeb.webPreviewPort}`;
                    const url = req.url || '';
                    
                    if (url.indexOf('/index.bundle') > 0 && req.headers?.referer) {
                        let sourceMap = req.headers.referer.replace('/index.html', '') + '/index.map';
                        if (url.indexOf('?') > 0) {
                            sourceMap += url.substring(url.indexOf('?'));
                        }
                        res.setHeader('SourceMap', sourceMap);
                    }
                    
                    res.setHeader('Content-Location', url);
                    if (url.indexOf('/index.bundle') > 0) {
                        streamToString(request(tUrl)).then(content => {
                            content = content.replace(/"\/assets\/\?unstable_path=/g, `"/${this.basePath}/assets/?unstable_path=`);
                            res.write(content);
                            res.end();
                        });
                    } else {
                        req.pipe(request(tUrl)).pipe(res);
                    }
                }
            } catch (e) {
                res.writeHead(500);
                console.error(e);
            }
        }).listen(this.proxyPort);
        logger.info({
            label: ExpoWeb.loggerLabel,
            message: `Service proxy launched at ${this.proxyUrl} .`
        });
        taskLogger.succeed(expoWebPreviewSteps[7].succeed);
    }

    async transpile(projectDir: string, previewUrl: string, incremental: boolean): Promise<void> {
        taskLogger.setTotal(expoWebPreviewSteps[3].total);
        taskLogger.start(expoWebPreviewSteps[3].start);

        try {
            await super.transpile(projectDir, previewUrl, incremental);
            const expoProjectDir = this.getExpoProjectDir(projectDir);
            const configJSONFile = `${expoProjectDir}/wm_rn_config.json`;
            const config = fs.readJSONSync(configJSONFile);
            config.serverPath = './_';
            fs.writeFileSync(configJSONFile, JSON.stringify(config, null, 4));

            if (!(config.sslPinning && config.sslPinning.enabled)) {
                await readAndReplaceFileContent(`${expoProjectDir}/App.js`, (content: string) => {
                    return content.replace('if (isSslPinningAvailable()) {', 'if (false && isSslPinningAvailable()) {');
                });
            }

            taskLogger.incrementProgress(2);
            logger.info({
                label: ExpoWeb.loggerLabel,
                message: `generated expo project at ${expoProjectDir}`
            });
            taskLogger.succeed(expoWebPreviewSteps[3].succeed);
        } catch (e) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            logger.error({
                label: ExpoWeb.loggerLabel,
                message: "Code Error: Kindly review and address the necessary corrections."
            });
        }
    }

    private async updateForWebPreview(projectDir: string): Promise<void> {
        try {
            taskLogger.setTotal(expoWebPreviewSteps[4].total);
            taskLogger.start(expoWebPreviewSteps[4].start);
            
            const packageFile = `${this.getExpoProjectDir(projectDir)}/package.json`;
            const pkg = JSON.parse(fs.readFileSync(packageFile, { encoding: 'utf-8' }));

            if (pkg['dependencies']['expo'] === '48.0.18') {
                this.expoVersion = '48.0.18';
                pkg.devDependencies['fs-extra'] = '^10.0.0';
                pkg.devDependencies['@babel/plugin-proposal-export-namespace-from'] = '7.18.9';
                delete pkg.devDependencies['esbuild'];
                delete pkg.devDependencies['esbuild-plugin-resolve'];
                fs.copySync(path.resolve(`${this.codegen}/src/templates/project/esbuild`), `${this.getExpoProjectDir(projectDir)}/esbuild`);

                await readAndReplaceFileContent(`${this.getExpoProjectDir(projectDir)}/babel.config.js`, (content: string): string => {
                    if (content.indexOf('@babel/plugin-proposal-export-namespace-from') < 0) {
                        content = content.replace(`'react-native-reanimated/plugin',`, `
                        '@babel/plugin-proposal-export-namespace-from',
                        'react-native-reanimated/plugin',
                        `);
                    }
                    return content.replace(`'transform-remove-console'`, '');
                });

                await readAndReplaceFileContent(`${this.getExpoProjectDir(projectDir)}/app.json`, (content: string): string => {
                    const appJson = JSON.parse(content);
                    if (!appJson['expo']['web']['bundler']) {
                        appJson['expo']['web']['bundler'] = 'metro';
                    }
                    return JSON.stringify(appJson, null, 4);
                });
            } else if (pkg['dependencies']['expo'] === '49.0.7') {
                this.expoVersion = '49.0.7';
                pkg.dependencies['react-native-svg'] = '13.4.0';
                pkg.dependencies['react-native-reanimated'] = '^1.13.2';
                pkg.dependencies['victory'] = '^36.5.3';
                pkg.devDependencies['fs-extra'] = '^10.0.0';
                delete pkg.devDependencies['esbuild'];
                delete pkg.devDependencies['esbuild-plugin-resolve'];
                fs.copySync(path.resolve(`${this.codegen}/src/templates/project/esbuild`), `${this.getExpoProjectDir(projectDir)}/esbuild`);
                await readAndReplaceFileContent(`${this.getExpoProjectDir(projectDir)}/babel.config.js`, (content: string) =>
                    content.replace(`'react-native-reanimated/plugin',`, ''));
            } else {
                this.expoVersion = pkg['dependencies']['expo'];
                pkg.dependencies['react-native-svg'] = '13.4.0';
                pkg.dependencies['victory'] = '^36.5.3';
                pkg.devDependencies['fs-extra'] = '^10.0.0';
                delete pkg.devDependencies['esbuild'];
                delete pkg.devDependencies['esbuild-plugin-resolve'];
                delete pkg.devDependencies['@expo/metro-config'];
                fs.copySync(path.resolve(`${this.codegen}/src/templates/project/esbuild`), `${this.getExpoProjectDir(projectDir)}/esbuild`);
            }

            fs.writeFileSync(packageFile, JSON.stringify(pkg, null, 4));
            await readAndReplaceFileContent(`${this.getExpoProjectDir(projectDir)}/esbuild/esbuild.script.js`, (content: string) =>
                content.replace('const esbuild', '//const esbuild').replace('const resolve', '//const resolve'));
            
            taskLogger.incrementProgress(1);
            taskLogger.succeed(expoWebPreviewSteps[4].succeed);
        } catch (e) {
            taskLogger.fail(expoWebPreviewSteps[4].fail);
            logger.info({
                label: ExpoWeb.loggerLabel,
                message: `The package update has failed. ${e}`
            });
        }
    }

    async installDependencies(projectDir: string): Promise<void> {
        try {
            taskLogger.setTotal(expoWebPreviewSteps[5].total);
            taskLogger.start(expoWebPreviewSteps[5].start);
            const expoDir = this.getExpoProjectDir(projectDir);
            if (fs.existsSync(`${expoDir}/node_modules/expo`)) {
                return;
            }

            logger.info({
                label: ExpoWeb.loggerLabel,
                message: "Dependency installation process initiated..."
            });

            taskLogger.incrementProgress(1);
            await super.installDependencies(expoDir);
            taskLogger.incrementProgress(2);
            taskLogger.succeed(expoWebPreviewSteps[5].succeed);
            await this.patchNodeModules(expoDir);
        } catch (e) {
            taskLogger.fail(expoWebPreviewSteps[5].fail);
            logger.error({
                label: ExpoWeb.loggerLabel,
                message: e + ' Encountered an error while installing dependencies.'
            });
        }
    }

    private async patchNodeModules(expoDir: string): Promise<void> {
        try {
            taskLogger.setTotal(expoWebPreviewSteps[6].total);
            taskLogger.start(expoWebPreviewSteps[6].start);
            await exec('node', ['./esbuild/esbuild.script.js', '--prepare-lib'], { cwd: expoDir });
            fs.copySync(`${expoDir}/esbuild/node_modules`, `${expoDir}/node_modules`, { overwrite: true });
            const nodeModulesDir = `${expoDir}/node_modules/@wavemaker/app-rn-runtime`;
            await readAndReplaceFileContent(`${expoDir}/node_modules/open/index.js`, (c: string) =>
                c.replace("const subprocess", 'return;\n\nconst subprocess'));
            await readAndReplaceFileContent(`${expoDir}/node_modules/@expo/cli/build/src/utils/open.js`, (c: string) =>
                c.replace('if (process.platform !== "win32")', 'return;\n\n if (process.platform !== "win32")'));
            await readAndReplaceFileContent(`${nodeModulesDir}/core/base.component.js`, (c: string) =>
                c.replace(/\?\?/g, '||'));
            await readAndReplaceFileContent(`${nodeModulesDir}/components/advanced/carousel/carousel.component.js`, (c: string) =>
                c.replace(/\?\?/g, '||'));
            await readAndReplaceFileContent(`${nodeModulesDir}/components/input/rating/rating.component.js`, (c: string) =>
                c.replace(/\?\?/g, '||'));

            if (this.expoVersion !== '52.0.17') {
                await readAndReplaceFileContent(`${expoDir}/node_modules/expo-camera/build/useWebQRScanner.js`, (c: string) => {
                    if (c.indexOf('@koale/useworker') > 0) {
                        return fs.readFileSync(`${__dirname}/../templates/expo-camera-patch/useWebQRScanner.js`, {
                            encoding: 'utf-8'
                        });
                    }
                    return c;
                });
            }
            
            taskLogger.incrementProgress(1);
            taskLogger.succeed(expoWebPreviewSteps[6].succeed);
            
            await readAndReplaceFileContent(`${expoDir}/node_modules/expo-font/build/ExpoFontLoader.web.js`, (content: string) => {
                if (this.expoVersion === '52.0.17') {
                    return content.replace(/src\s*:\s*url\(\$\{resource\.uri\}\);/g, 'src:url(.${resource.uri.replace("//rn-bundle//","/")});');
                }
                return content.replace(/src\s*:\s*url\(\$\{resource\.uri\}\);/g, 'src:url(.${resource.uri});');
            });

            await readAndReplaceFileContent(`${expoDir}/node_modules/@expo/metro-config/build/serializer/environmentVariableSerializerPlugin.js`, (content: string) => {
                content = content.replace('getEnvPrelude(str)', '//getEnvPrelude(str)');
                return content.replace('// process.env', '// process.env \n firstModule.output[0].data.code = firstModule.output[0].data.code + str;');
            });
        } catch(e) {
            taskLogger.fail(expoWebPreviewSteps[6].fail);
            logger.error({
                label: ExpoWeb.loggerLabel,
                message: e + ' Encountered an error while applying node patches.'
            });
        }
    }

    private async setup(previewUrl: string, _clean: boolean, authToken?: string) {
        taskLogger.setTotal(expoWebPreviewSteps[0].total);
        taskLogger.start(expoWebPreviewSteps[0].start);
        const projectName = await this.getProjectName(previewUrl);
        const projectDir = `${(global as any).rootDir}/wm-projects/${projectName.replace(/\s+/g, '_').replace(/\(/g, '_').replace(/\)/g, '_')}`;
        if (_clean) {
            this.clean(projectDir);
        } else {
            fs.mkdirpSync(this.getWmProjectDir(projectDir));
        }
        taskLogger.incrementProgress(1);
        taskLogger.succeed(expoWebPreviewSteps[0].succeed);
        const syncProject = await projectSyncService.setupProject(previewUrl, projectName, projectDir, authToken);
        await this.transpile(projectDir, previewUrl, false);
        await this.updateForWebPreview(projectDir);
        await this.installDependencies(projectDir);
        return { projectDir, syncProject };
    }

    public async runWeb(previewUrl: string, clean: boolean, authToken?: string): Promise<void> {
        logger.info({
            label: ExpoWeb.loggerLabel,
            message: `Local preview processing has started. Please ensure that the preview is active.`
        });

        try {
            const { projectDir, syncProject } = await this.setup(previewUrl, clean, authToken);
            let isExpoStarted = false;
            this.isExpoPreviewContainer = await isExpoWebPreviewContainer(previewUrl);
            taskLogger.info(`generated expo web app at ${chalk.blue(projectDir)}`);
            this.launchServiceProxy(projectDir, previewUrl);
            // exec('npx', ['expo', 'start', '--web', '--offline', `--port=${ExpoWeb.webPreviewPort}`], {
            //     cwd: this.getExpoProjectDir(projectDir),
            // });
            // await new Promise(resolve => setTimeout(resolve, 5000));
            // taskLogger.succeed(chalk.green("Esbuild finished ") + chalk.blue(`Service proxy launched at ${this.proxyUrl}`));
            this.watchProjectChanges(previewUrl, () => {
                const startTime = Date.now();
                syncProject()
                    .then(() => {
                        logger.info({
                            label: ExpoWeb.loggerLabel,
                            message: `Sync Time: ${(Date.now() - startTime) / 1000}s.`
                        });
                        taskLogger.info(`Sync Time: ${(Date.now() - startTime) / 1000}s.`);
                    })
                    .then(() => {
                        return this.transpile(projectDir, previewUrl, true).then(() => {
                            if (!isExpoStarted) {
                                isExpoStarted = true;
                                exec('npx', ['expo', 'start', '--web', '--offline', `--port=${ExpoWeb.webPreviewPort}`], {
                                        cwd: this.getExpoProjectDir(projectDir),
                                    });
                                new Promise(resolve => setTimeout(resolve, 5000));
                                taskLogger.succeed(chalk.green("Expo web bulid finished ") + chalk.blue(`Service proxy launched at ${this.proxyUrl}`));
                            }
                        }).then(() => {
                            isExpoStarted = true;
                            logger.info({
                                label: ExpoWeb.loggerLabel,
                                message: `Total Time: ${(Date.now() - startTime)/ 1000}s.`
                            });
                            taskLogger.info(`Total Time: ${(Date.now() - startTime)/ 1000}s.`);
                        });
                    }).catch(err => {
                        taskLogger.warn("Error occurred: ", err);
                        console.error(err);
                    });
            });

            this.watchForPlatformChanges(() => this.transpile(projectDir, previewUrl, false));
        } catch (e) {
            logger.error({
                label: 'watch-project-changes-error',
                message: e
            });
        }
    }

    public runExpoWebApp(previewUrl: string, clean: boolean, authToken?: string, proxyHost?: string, basePath?: string) {
        proxyHost = proxyHost || 'localhost';
        if (basePath) {
            this.basePath = basePath;
        }
        return this.runWeb(previewUrl, clean, authToken);
    }
}

const expoWeb = new ExpoWeb();
export const runExpoWebApp = expoWeb.runExpoWebApp.bind(expoWeb);
export default expoWeb;
