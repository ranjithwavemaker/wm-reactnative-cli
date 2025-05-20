import { URL } from 'url';
import fs from 'fs-extra';
import path from 'path';
import logger from '../utils/logger';
import prompt from 'prompt';
import axios, { AxiosResponse } from 'axios';
import os from 'os';
import qs from 'qs';
import semver from 'semver';
import { exec } from '../utils/exec';
import { unzip } from '../utils/utils';
import { spinnerBar as taskLogger } from '../custom-logger/task-logger';
import { previewSteps } from '../utils/steps';
import chalk from 'chalk';

interface ProjectConfig {
    authCookie: string;
    baseUrl: string;
    appPreviewUrl: string;
    projectName: string;
}

interface Project {
    displayName: string;
    name: string;
    vcsBranchId: string;
    platformVersion: string;
    studioProjectId: string;
}

interface Credentials {
    username: string;
    password: string;
}

interface AuthToken {
    token: string;
}

interface Properties {
    [key: string]: any;
}

const MAX_REQUEST_ALLOWED_TIME = 5 * 60 * 1000;

export class ProjectSyncService {
    remoteBaseCommitId: string = '';
    WM_PLATFORM_VERSION: string = '';
    loggerLabel: string =  'project-sync-service';
    STORE_KEY: string = 'user.auth.token';

    async findProjectId(config: ProjectConfig): Promise<string | undefined> {
        const projectList = (await axios.get(`${config.baseUrl}/edn-services/rest/users/projects/list`,
            {headers: {
                cookie: config.authCookie
            }})).data;
        const project = projectList.filter((p: Project) => p.displayName === config.projectName)
            .filter((p: Project) => (config.appPreviewUrl.endsWith(p.name + "_" + p.vcsBranchId)));
        if (project && project.length) {
            this.WM_PLATFORM_VERSION = project[0].platformVersion;
            return project[0].studioProjectId;
        }
    }

    async downloadFile(res: AxiosResponse, tempFile: string): Promise<void> {
        if (res.status !== 200) {
            throw new Error('failed to download the project');
        }
        await new Promise<void>((resolve, reject) => {
            const fw = fs.createWriteStream(tempFile);
            res.data.pipe(fw);
            fw.on('error', err => {
                reject(err);
                fw.close();
            });
            fw.on('close', () => resolve());
        });
    }

    async downloadProject(projectId: string, config: ProjectConfig, projectDir: string): Promise<void> {
        try {
            const start = Date.now();
            logger.info({label: this.loggerLabel, message: 'downloading the project...'});
            taskLogger.start(previewSteps[2].start);
            taskLogger.setTotal(previewSteps[2].total);
            const tempFile = `${os.tmpdir()}/changes_${Date.now()}.zip`;
            
            if (semver.lt(this.WM_PLATFORM_VERSION, '11.4.0')) {
                const res = await axios.get(`${config.baseUrl}/studio/services/projects/${projectId}/vcs/gitInit`, {
                    responseType: 'stream',
                    headers: {
                        cookie: config.authCookie
                    }
                });
                taskLogger.incrementProgress(2);
                await this.downloadFile(res, tempFile);
                taskLogger.incrementProgress(1);
                const gitDir = path.join(projectDir, '.git');
                fs.mkdirpSync(gitDir);
                await unzip(tempFile, gitDir);
                await exec('git', ['restore', '.'], {cwd: projectDir});
                taskLogger.incrementProgress(1);
            } else {
                const gitInfo = await axios.get(`${config.baseUrl}/studio/services/projects/${projectId}/vcs/gitBare`, {
                    headers: {
                        cookie: config.authCookie
                    }
                });
                taskLogger.incrementProgress(2);
                if(gitInfo.status !== 200){
                    throw new Error('failed to download the project');
                }
                const fileId = gitInfo.data.fileId;
                this.remoteBaseCommitId = gitInfo.data.remoteBaseCommitId;
                const res = await axios.get(`${config.baseUrl}/file-service/${fileId}`, {
                    responseType: 'stream',
                    headers: {
                        cookie: config.authCookie
                    }
                });
                taskLogger.incrementProgress(2);
                await this.downloadFile(res, tempFile);
                const tempDir = path.join(`${os.tmpdir()}`, `project_${Date.now()}`);
                fs.mkdirpSync(tempDir);
                const gitDir = path.join(projectDir, '.git');
                if(fs.existsSync(gitDir)){
                    await unzip(tempFile, gitDir);
                    await exec('git', ['config', '--local', '--unset', 'core.bare'], {cwd: projectDir});
                    await exec('git', ['restore', '.'], {cwd: projectDir});
                } else {
                    await unzip(tempFile, tempDir);
                    fs.rmSync(projectDir, { recursive: true, force: true });
                    await exec('git', ['clone', '-b', 'master', tempDir, projectDir]);
                }
                fs.rmSync(tempDir, { recursive: true, force: true });
                taskLogger.incrementProgress(1);
            }
            logger.info({
                label: this.loggerLabel,
                message: `downloaded the project in (${Date.now() - start} ms).`
            });
            taskLogger.incrementProgress(1);
            taskLogger.succeed(`${previewSteps[2].succeed} in (${Date.now() - start} ms).`);
            fs.unlink(tempFile);
            
            const logDirectory = projectDir + '/output/logs/';
            fs.mkdirSync(logDirectory, {
                recursive: true
            });
            logger.info({
                label: this.loggerLabel,
                message: 'log directory = '+ logDirectory
            });
            global.logDirectory = logDirectory;
            logger.setLogDirectory(logDirectory);
            taskLogger.info("Full log details can be found in: " + chalk.blue(logDirectory));
        } catch (e) {
            logger.info({
                label: this.loggerLabel,
                message: e+` The download of the project has encountered an issue. Please ensure that the preview is active.`
            });
            taskLogger.fail(e+` ${previewSteps[2].fail}`);
        }
    }

    async gitResetAndPull(tempDir: string, projectDir: string): Promise<void> {
        await exec('git', ['clean', '-fd', '-e', 'output'], {cwd: projectDir});
        await exec('git', ['fetch', path.join(tempDir, 'remoteChanges.bundle'), 'refs/heads/master'], {cwd: projectDir});
        await exec('git', ['reset', '--hard', 'FETCH_HEAD'], {cwd: projectDir});
    }

    async pullChanges(projectId: string, config: ProjectConfig, projectDir: string): Promise<void> {
        try {
            const output = await exec('git', ['rev-parse', 'HEAD'], {
                cwd: projectDir
            });
            const headCommitId = output[0];
            logger.debug({label: this.loggerLabel, message: 'HEAD commit id is ' + headCommitId});
            taskLogger.setTotal(6);
            taskLogger.start('Preparing to pull changes from studio...');
            taskLogger.incrementProgress(1);
            
            const tempDir = path.join(`${os.tmpdir()}`, `changes_${Date.now()}`);
            
            if (semver.lt(this.WM_PLATFORM_VERSION, '11.4.0')) {
                const tempFile = `${os.tmpdir()}/changes_${Date.now()}.zip`;
                taskLogger.setText('Fetching remote changes from studio...');
                taskLogger.incrementProgress(1);
                
                const res = await axios.get(`${config.baseUrl}/studio/services/projects/${projectId}/vcs/remoteChanges?headCommitId=${headCommitId}`, {
                    responseType: 'stream',
                    headers: {
                        cookie: config.authCookie
                    }
                });
                taskLogger.setText('Downloading changes...');
                taskLogger.incrementProgress(1);
                
                await this.downloadFile(res, tempFile);
                fs.mkdirpSync(tempDir);
                await unzip(tempFile, tempDir);
            
                taskLogger.setText('Applying changes to local repository...');
                taskLogger.incrementProgress(1);
                
                await this.gitResetAndPull(tempDir, projectDir);
                await exec('git', ['apply', '--allow-empty', '--ignore-space-change', path.join(tempDir, 'patchFile.patch')], {cwd: projectDir});
                logger.debug({label: this.loggerLabel, message: 'Copying any uncommitted binary files'});
                this.copyContentsRecursiveSync(path.join(tempDir, 'binaryFiles'), projectDir);    
                fs.unlink(tempFile);
                taskLogger.incrementProgress(1);
            } else {
                taskLogger.setText('Fetching git info from studio...');
                taskLogger.incrementProgress(1);
                
                const gitInfo = await axios.get(`${config.baseUrl}/studio/services/projects/${projectId}/vcs/pull?lastPulledWorkspaceCommitId=${headCommitId}&lastPulledRemoteHeadCommitId=${this.remoteBaseCommitId}`, {
                    headers: {
                        cookie: config.authCookie
                    }
                });
                if (gitInfo.status !== 200) {
                    throw new Error('failed to pull project changes');
                }
                const fileId = gitInfo.data.fileId;
                this.remoteBaseCommitId = gitInfo.data.remoteBaseCommitId;
                
                taskLogger.setText('Downloading changes bundle...');
                taskLogger.incrementProgress(1);
                
                const res = await axios.get(`${config.baseUrl}/file-service/${fileId}`, {
                    responseType: 'stream',
                    headers: {
                        cookie: config.authCookie
                    }
                });
                fs.mkdirpSync(tempDir);
                const tempFile = `${tempDir}/remoteChanges.bundle`;
                await this.downloadFile(res, tempFile);
                
                taskLogger.setText('Applying changes to repository...');
                taskLogger.incrementProgress(1);
                
                await this.gitResetAndPull(tempDir, projectDir);
                fs.unlink(tempFile);
                taskLogger.incrementProgress(1);
            }
            fs.rmSync(tempDir, { recursive: true, force: true });
            taskLogger.succeed(`pulled new changes from studio - head commit id ${headCommitId}`);
            
            let filesChanged = await exec('git', ['diff','--name-status', 'HEAD~1', 'HEAD'], {cwd: projectDir});
            filesChanged = filesChanged.filter(Boolean);
            const changes = filesChanged.map((line: string) => {
                const [status, ...fileParts] = line.trim().split(/\s+/);
                const filePath = fileParts.join(' ').replace(/^.*webapp\//, '');
                return { status, filePath };
            });
            
            const formatted = changes.map(({ status, filePath }: { status: string; filePath: string }) => {
                const color = status === 'A' ? chalk.green
                            : status === 'D' ? chalk.red
                            : status === 'M' ? chalk.yellow
                            : chalk.cyan;
                return `${color(status)}:${color(filePath)}`;
            });
            taskLogger.info("Files changed: \n\t" + formatted.join('\n\t'));
        } catch (e) {
            logger.info({
                label: this.loggerLabel,
                message: e+` The attempt to execute "git pull" was unsuccessful. Please verify your connections.`
            });
            taskLogger.fail(e+` The attempt to execute "git pull" was unsuccessful. Please verify your connections.`);
        }
    }

    copyContentsRecursiveSync(src: string, dest: string): void {
        fs.readdirSync(src).forEach(file => {
            const childSrc = path.join(src, file);
            const childDest = path.join(dest, file);
            const exists = fs.existsSync(childSrc);
            const stats = exists ? fs.statSync(childSrc) : null;
            const isDirectory = stats?.isDirectory() || false;
            if (isDirectory) {
                if (!fs.existsSync(childDest)) {
                    fs.mkdirSync(childDest);
                }
                this.copyContentsRecursiveSync(childSrc, childDest);
            } else {
                fs.copyFileSync(childSrc, childDest);
            }
        });
    }

    extractAuthCookie(res: any): string | undefined {
        const headers = res && res.response && res.response.headers;
        if (!headers) {
            return;
        }
        const result = headers['set-cookie'].filter((s: string) => s.indexOf('auth_cookie') >= 0);
        if (result.length) {
            return result[0].split(';')[0];
        }
    }

    async authenticateWithUserNameAndPassword(config: ProjectConfig): Promise<string> {
        const credentials = await this.getUserCredentials();
        const response = await axios.post(`${config.baseUrl}/login/authenticate`, 
            qs.stringify({
                j_username: credentials.username,
                j_password: credentials.password
            }), {
                maxRedirects: 0
        }).catch((res) => {
            const cookie = this.extractAuthCookie(res);
            if (!cookie) {
                console.log('Not able to login. Try again.');
                return this.authenticateWithUserNameAndPassword(config);
            }
            return cookie;
        });
        return response as string;
    }

    async authenticateWithToken(config: ProjectConfig, showHelp: boolean): Promise<string> {
        try {
            if (showHelp) {
                console.log('***************************************************************************************');
                console.log('* Please open the below url in the browser, where your WaveMaker studio is opened.    *');
                console.log('* Copy the response content and paste in the terminal.                                *');
                console.log('***************************************************************************************');
                console.log(`\n\n`);
                console.log(`${config.baseUrl}/studio/services/auth/token`);
                console.log(`\n\n`);
            }
            const cookie = (await this.getAuthToken()).token.split(';')[0];
            if (!cookie) {
                console.log('Not able to login. Try again.');
                return this.authenticateWithToken(config, true);
            }
            return 'auth_cookie='+cookie;
        } catch (e) {
            logger.info({
                label: this.loggerLabel,
                message: e+` Your authentication has failed. Please proceed with a valid token.`
            });
            throw e;
        }
    }

    getUserCredentials(): Promise<Credentials> {
        const schema = {
            properties: {
                username: {
                    required: true
                },
                password: {
                    required: true,
                    hidden: true
                }
            }
        };
        prompt.start();
        return new Promise((resolve, reject) => {
            prompt.get(schema, (err, result) => {
                if (err) {
                    reject(err);
                } else {
                    resolve({
                        username: result.username as string,
                        password: result.password as string
                    });
                }
            });
        });
    }

    getAuthToken(): Promise<AuthToken> {
        const schema = {
            properties: {
                token: {
                    required: true
                }
            }
        };
        prompt.start();
        return new Promise((resolve, reject) => {
            prompt.get(schema, (err, result) => {
                if (err) {
                    reject(err);
                } else {
                    resolve({
                        token: result.token as string
                    });
                }
            });
        });
    }

    async checkAuthCookie(config: ProjectConfig): Promise<boolean> {
        try {
            await this.findProjectId(config);
            logger.info({
                label: this.loggerLabel,
                message: `user authenticated.`
            });
        } catch(e) {
            return false;
        }
        return true;
    }

    async setup(previewUrl: string, projectName: string, authToken?: string): Promise<ProjectConfig> {
        if (authToken) {
            authToken = 'auth_cookie=' + authToken;
        }
        if (previewUrl.endsWith('/')) {
            previewUrl = previewUrl.slice(0, -1);
        }
        const config: ProjectConfig = {
            authCookie: authToken || global.localStorage.getItem(this.STORE_KEY) || '',
            baseUrl: new URL(previewUrl).origin,
            appPreviewUrl: previewUrl,
            projectName: projectName
        };
        const isAuthenticated = await this.checkAuthCookie(config);
        if (!isAuthenticated) {
            config.authCookie = await this.authenticateWithToken(config, true);
        }
        global.localStorage.setItem(this.STORE_KEY, config.authCookie);
        taskLogger.incrementProgress(1);
        taskLogger.succeed(previewSteps[1].succeed);
        return config;
    }

    public async setupProject(previewUrl: string, projectName: string, toDir: string, authToken?: string): Promise<() => Promise<void>> {
        const config = await this.setup(previewUrl, projectName, authToken);
        const projectId = await this.findProjectId(config);
        if (!projectId) {
            throw new Error('Project not found');
        }
        await this.downloadProject(projectId, config, toDir);
        return () => this.pullChanges(projectId, config, toDir);
    }
}

export default new ProjectSyncService(); 