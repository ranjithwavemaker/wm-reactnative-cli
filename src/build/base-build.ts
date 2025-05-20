import path, { resolve } from "path";
import { isWindowsOS } from "../utils/utils";
import * as fs from 'fs-extra';
import { unzip } from "../utils/utils";
import logger from "../utils/logger";
import { showConfirmation, readAndReplaceFileContent } from "../utils/utils";
import crypto from 'crypto';
// import this.config from "../this.config";
import { exec } from "../utils/exec";
import { VERSIONS, canDoEmbed, canDoAndroidBuild, canDoIosBuild } from "../utils/requirements";
import chalk from 'chalk';
const taskLogger = require('../custom-logger/task-logger').spinnerBar;
import { buildSteps } from '../utils/steps';
import { BuildArgs } from "../types/cli-args";

export interface BuildResult {
    success: boolean;
    errors?: string[];
    output?: string;
}

export interface ConfigOptions {
    src: string;
    buildType: string;
    logDirectory: string;
    outputDirectory: string;
    metaData: Record<string, any>;
    embed: boolean;
    platform?: string;
} 

export class BaseBuild {
    loggerLabel:string = 'wm-reactnative-cli'
    args: BuildArgs;
    config: ConfigOptions = {
        src: '',
        buildType: '',
        logDirectory: '',
        outputDirectory: '',
        metaData: {},
        embed: false
    };

    constructor(args: BuildArgs) {
        this.args = args;
    }
    
    async readWmRNConfig(src: string): Promise<any> {
        src = path.resolve(src) + '/';
        let jsonPath = src + 'wm_rn_config.json';
        const fileContent = await fs.readFileSync(jsonPath, 'utf8');
        let data: any = JSON.parse(fileContent);
        data.preferences = data.preferences || {};
        data.preferences.enableHermes = true;
        return data;
    }

    async extractRNZip(src: string)  {
        let folderName: string = (isWindowsOS() ? src.split('\\').pop() : src.split('/').pop()) || '';
        const isZipFile = folderName.endsWith('.zip');
    
        folderName = isZipFile ? folderName.replace('.zip', '') : folderName;
    
        const tmp = `${require('os').homedir()}/.wm-reactnative-cli/temp/${folderName}/${Date.now()}`;
    
        if (src.endsWith('.zip')) {
            const zipFile = src;
            src = tmp + '/src';
    
            if (!fs.existsSync(src)) {
                fs.mkdirsSync(src);
            }
            await unzip(zipFile, src);
        }
        return path.resolve(src) + '/';
    }

    async getDefaultDestination(id: string, platform: string) {
        const version = '1.0.0';
        const path = `${require('os').homedir()}/.wm-reactnative-cli/build/${id}/${version}/${platform}`;
        fs.mkdirSync(path, {
            recursive: true
        });
        let next = 1;
        if (fs.existsSync(path)) {
            next = fs.readdirSync(path).reduce((a, f) => {
                try {
                    const c = parseInt(f);
                    if (a <= c) {
                        return c + 1;
                    }
                } catch(e) {
                    //not a number
                }
                return a;
            }, next);
        }
        const dest = path + '/' + next;
        fs.mkdirSync(dest, {
            recursive: true
        });
        return dest;
    }

    async updateAppJsonFile(src: string) {
        const path = (src || this.config.src) + 'app.json';
        logger.info({
            label: this.loggerLabel,
            message: 'path at app.json ' + path
        })
        try {
            if (fs.existsSync(path)) {
                let data = fs.readFileSync(path, 'utf8');
                const jsonData = JSON.parse(data);
                jsonData['expo']['name'] = this.config.metaData.name;
                jsonData['expo']['slug'] = this.config.metaData.name;
                jsonData['expo']['android']['package'] = this.config.metaData.id;
                jsonData['expo']['ios']['bundleIdentifier'] = this.config.metaData.id;
                jsonData['expo']['jsEngine'] = this.config.metaData.preferences.enableHermes ? 'hermes' : 'jsc';
                jsonData['expo']['icon'] = this.config.metaData.icon.src;
                jsonData['expo']['splash']['image'] = this.config.metaData.splash.src;
                jsonData['expo']['android']['adaptiveIcon']['foregroundImage'] = this.config.metaData.icon.src;
                fs.writeFileSync(path, JSON.stringify(jsonData), 'utf-8');
            }
        } catch (e) {
            throw new Error(`Error updating app.json: ${e}`);
        }
    }

    async setupBuildDirectory(src: string, dest: string, platform: string) {
        try {
            taskLogger.setTotal(buildSteps[0].total);
            taskLogger.start(buildSteps[0].start);
            src = await this.extractRNZip(src);
            taskLogger.incrementProgress(1);
            const metadata = await this.readWmRNConfig(src);
            taskLogger.incrementProgress(1);
            if (fs.existsSync(dest)) {
                if (fs.readdirSync(dest).length) {
                    taskLogger.stop();
                    const response = await showConfirmation('Would you like to empty the dest folder (i.e. ' + dest + ') (yes/no) ?');
                    taskLogger.start();
                    if (response !== 'y' && response !== 'yes') {
                        // logger.error({
                        //     label: this.loggerLabel,
                        //     message: 'Non empty folder cannot be used as desination. Please choose a different destination and build again.'
                        // });
                        // taskLogger.fail("Non empty folder cannot be used as desination. Please choose a different destination and build again.")
                        // return;
                    }else{
                        // using removeSync when dest is directory and unlinkSync works when dest is file.
                        const fsStat = fs.lstatSync(dest);
                        if (fsStat.isDirectory()) {
                            fs.removeSync(dest);
                        } else if (fsStat.isFile()) {
                            fs.unlinkSync(dest);
                        }
                    }
                }
            }
            taskLogger.incrementProgress(1);
            dest = dest || await this.getDefaultDestination(metadata.id, platform);
            if(isWindowsOS()){
                const buildDirHash = crypto.createHash("shake256", { outputLength: 8 }).update(dest).digest("hex");
                dest = path.resolve(`${global.rootDir}/wm-build/` + buildDirHash + "/");
            }
            dest = path.resolve(dest)  + '/';
            if(src === dest) {
                logger.error({
                    label: this.loggerLabel,
                    message: 'source and destination folders are same. Please choose a different destination.'
                });
                taskLogger.fail('source and destination folders are same. Please choose a different destination.');
                return;
            }
            taskLogger.incrementProgress(1);
            fs.mkdirsSync(dest);
            fs.copySync(src, dest);
            taskLogger.incrementProgress(1);
            const logDirectory = dest + 'output/logs/';
            fs.mkdirSync(logDirectory, {
                recursive: true
            });
            global.logDirectory = logDirectory;
            logger.setLogDirectory(logDirectory);
            taskLogger.info("Full log details can be found in: " + chalk.blue(logDirectory));
            taskLogger.succeed(buildSteps[0].succeed);
            return {
                src: src,
                dest: dest
            };
        } catch (e: any) {
            taskLogger.fail("Setup directories failed. " + chalk.gray("Due to : ")  + chalk.cyan(e.message));
        }
    }

    getFileSize(path: string) {
        const stats = path && fs.statSync(path);
        return (stats && stats['size']) || 0;
    }

    async prepareProject() {
        try {
            taskLogger.setTotal(buildSteps[1].total);
            taskLogger.start(buildSteps[1].start);
            this.config.src = this.args.dest || '';
            logger.info({
                label: this.loggerLabel,
                message: 'destination folder where app is build at ' +this.args.dest,
            });
            taskLogger.info('destination folder where app is build at ' + this.args.dest);
            if (!this.args.platform) {
                this.args.platform = 'android';
            }
            this.config.platform = this.args.platform;
            this.config.buildType = this.args.buildType;
    
            if (this.args.platform !== 'android') {
                VERSIONS.JAVA = '1.8.0';
            }
            const prerequisiteError = {
                errors: 'check if all prerequisites are installed.',
                success: false
            };
            if (this.config.embed) {
                if (!await canDoEmbed()) {
                    return prerequisiteError;
                }
            }
            if (this.args.platform === 'android') {
                if (!await canDoAndroidBuild()) {
                    return prerequisiteError;
                }
            }
            if (this.args.platform === 'ios') {
                if (!await canDoIosBuild()) {
                    return prerequisiteError;
                }
            }
            taskLogger.incrementProgress(1);
            taskLogger.succeed(buildSteps[1].succeed);
            taskLogger.setTotal(buildSteps[2].total);
            taskLogger.start(buildSteps[2].start);
            await this.updateAppJsonFile(this.config.src);
            logger.info({
                label: this.loggerLabel,
                message: 'app.json updated.... ' + this.args.dest
            })
            await this.updatePackageJsonFile(this.config.src + 'package.json');
            taskLogger.incrementProgress(0.2);
            try {
                await exec('yarn', ['install'], {
                    cwd: this.config.src
                });
                taskLogger.succeed("All dependencies installed successfully.")
            } catch (e: any) {
                logger.error({
                    label: this.loggerLabel,
                    message: "Dependency installation failed. Due to : "+ e,
                });
                taskLogger.fail("Dependency installation failed. Due to : "+ e);
            }
        } catch (e: any) {
            logger.error({
                label: this.loggerLabel,
                message: this.args.platform + ' prepare project Failed. Due to :' + e,
            });
            taskLogger.fail(this.args.platform + ' prepare project Failed. Due to :' + e);
            return { errors: e, success : false };
        }
    }

    updatePackageJsonFile(path: string) {
        try {
            let data = fs.readFileSync(path, 'utf-8');
            //downgrading expo-av to 11 to address the build failure issue
            data = data.replace(/"expo-av"[\s]*:[\s]*"~13.0.1"/, '"expo-av": "~11.0.1"');
            const jsonData = JSON.parse(data);
            jsonData['main'] = "index";
            if (this.config.embed) {
                jsonData['dependencies']['@wavemaker/expo-native-module'] = "latest";
            }
            if(!jsonData['devDependencies']['@babel/plugin-proposal-optional-chaining']){
                jsonData['devDependencies']['@babel/plugin-proposal-optional-chaining'] = "^7.21.0";
            }
            if(!jsonData['devDependencies']['@babel/plugin-proposal-nullish-coalescing-operator']){
                jsonData['devDependencies']['@babel/plugin-proposal-nullish-coalescing-operator'] = "^7.18.6";
            }
            if (!jsonData['dependencies']['lottie-react-native']
                || jsonData['dependencies']['lottie-react-native'] === '5.1.5') {
                jsonData['dependencies']['lottie-react-native'] = "^5.1.5";
                jsonData['dependencies']['react-lottie-player'] = "^1.5.4";
            }
            if (jsonData['dependencies']['expo-file-system'] === '^15.1.1') {
                jsonData['dependencies']['expo-file-system'] = '15.2.2'
            }
            if (jsonData['dependencies']['axios'] === '^1.4.0') {
                jsonData['dependencies']['axios'] = '1.6.8';
            }
            const resolutions = jsonData["resolutions"] || {};
            if (!resolutions['expo-application']) {
                resolutions['expo-application'] = '5.8.4';
            }
            if (!resolutions['axios']) {
                resolutions['axios'] = '1.6.8';
            }
            if (jsonData['dependencies']['expo'] === '50.0.17') {
                resolutions['metro'] = '0.80.9';
            }
            jsonData["resolutions"] = resolutions;
            if (this.config.platform === 'android') {
                jsonData['dependencies']['@react-native-cookies/cookies'] = '6.2.1';
            }
            fs.writeFileSync(path, JSON.stringify(jsonData), 'utf-8');
            logger.info({
                'label': this.loggerLabel,
                'message': 'updated package.json file'
            });
        } catch (e) {
            throw new Error(`Error updating package.json: ${e}`);
        }
    }

    async ejectProject(args: any) {
        try {
            taskLogger.start(buildSteps[3].start);
            taskLogger.setTotal(buildSteps[3].total);
            taskLogger.incrementProgress(1);
            if(args.platform){
                await exec('npx', ['expo','prebuild', "--platform", args.platform], {
                    cwd: this.config.src
                });
            }else{
                await exec('npx', ['expo','prebuild'], {
                    cwd: this.config.src
                });
            }
            taskLogger.incrementProgress(1);
            logger.info({
                label: this.loggerLabel,
                message: 'expo eject succeeded',
            });
            if (args.localrnruntimepath) {
                const linkFolderPath =
                this.config.src + 'node_modules/@wavemaker/app-rn-runtime';
                // using removeSync when target is directory and unlinkSync works when target is file.
                if (fs.existsSync(linkFolderPath)) {
                    fs.removeSync(linkFolderPath);
                }
                await fs.mkdirsSync(linkFolderPath);
                await fs.copySync(args.localrnruntimepath, linkFolderPath);
                logger.info({
                    label: this.loggerLabel,
                    message: 'copied the app-rn-runtime folder',
                });
                taskLogger.info("copied the app-rn-runtime folder");
            }
            taskLogger.succeed(buildSteps[3].succeed);
        } catch (e: any) {
            logger.error({
                label: this.loggerLabel,
                message: args.platform + ' eject project Failed. Due to :' + e,
            });
            taskLogger.fail(buildSteps[3].fail);
            return { errors: e, success: false };
        }
    }

    async setupConfig() {
        const directories = await this.setupBuildDirectory(this.args.src, this.args.dest || '', this.args.platform || '');
        if (!directories) {
            return {
                success : false,
                errors: 'could not setup the build directories.'
            };
        }
        this.args.src = directories.src;
        this.args.dest = directories.dest;
     
        this.config.metaData = await this.readWmRNConfig(this.args.src);
    
        if (this.config.metaData.icon.src.startsWith('resources')) {
            this.config.metaData.icon.src = 'assets/' + this.config.metaData.icon.src;
        }
        if (this.config.metaData.splash.src.startsWith('resources')) {
            this.config.metaData.splash.src = 'assets/' + this.config.metaData.splash.src;
        }
             
         if (this.args.dest) {
            this.args.dest = path.resolve(this.args.dest) + '/';
         }

    }
}

export const prepareProject = async (args: any) => {
    args.targetPhase = 'PREPARE';
    args.platform = 'expo';
    
    const baseBuild = new BaseBuild(args);
    await baseBuild.setupConfig();
    await baseBuild.prepareProject();
    
    const loggerLabel = 'wm-reactnative-cli';
    logger.info({
        label: loggerLabel,
        message: `Project is prepared at : ${args.dest}.`,
    });
};