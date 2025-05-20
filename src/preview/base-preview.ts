const os = require('os');
import * as fs from 'fs-extra';
import * as path from 'path';
import * as semver from 'semver';
import projectSyncService from "../services/project-sync.service";
import axios from 'axios';
import rimraf from 'rimraf';
import { exec } from '../utils/exec';
import { readAndReplaceFileContent } from '../utils/utils';
import { ExpoWeb } from './expo-web';
import logger from '../utils/logger';
import { EsBuildWeb } from './esbuild-web';
const taskLogger = require('../custom-logger/task-logger').spinnerBar;
const httpProxy = require('http-proxy');
import * as http from 'http';
import request from 'request';

export abstract class BasePreview {
    codegen: string = '';
    rnAppPath: string = '';
    packageLockJsonFile: string = '';
    private lastKnownModifiedTime = {
      'rn-runtime': 0,
      'rn-codegen': 0,
      'ui-variables': 0,
    };
    etag: string = '';
    isExpoPreviewContainer: boolean = false;
    proxy: any;

    constructor() {
    }

    protected abstract updateProfileConfig(projectDir: string): Promise<void>;
    protected abstract getProfileName(): string;
    protected abstract getExpoProjectDir(projectDir: string): string;
    protected abstract getLoggerLabel(): string;

    protected launchServiceProxy(
        projectDir: string, 
        previewUrl: string, 
    ): any {
        this.proxy = httpProxy.createProxyServer({});
        const wmProjectDir = this.getWmProjectDir(projectDir);

        this.proxy.on('proxyReq', (proxyReq: http.ClientRequest, req: http.IncomingMessage, res: http.ServerResponse, options: any) => {
            proxyReq.setHeader('sec-fetch-mode', 'no-cors');
            proxyReq.setHeader('origin', previewUrl);
            proxyReq.setHeader('referer', previewUrl);
        });

        this.proxy.on('proxyRes', (proxyRes: http.IncomingMessage, req: http.IncomingMessage, res: http.ServerResponse, options: any) => {
            let cookies = proxyRes.headers['set-cookie'];
            if (cookies) {
                cookies = typeof cookies === 'string' ? [cookies] : cookies;
                cookies = cookies.map((c: string) => c.replace(/;?\sSecure/, ''));
                proxyRes.headers['set-cookie'] = cookies;
            }
        });

        this.proxy.on('error', (err: Error) => {
            logger.error({
                label: this.getLoggerLabel(),
                message: err
            });
            taskLogger.fail(err);
        });
    }

    getIpAddress(): string {
      const interfaces = os.networkInterfaces();
      for (const key in interfaces) {
          const addresses = interfaces[key];
          for (let i = 0; i < addresses.length; i++) {
              const address = addresses[i];
              if (!address.internal && address.family === 'IPv4') {
                  return address.address;
              }
          }
      }
      return 'localhost';
    }

    getWmProjectDir(projectDir: string): string {
      return `${projectDir}/src/main/webapp`;
    }

    async getProjectName(previewUrl: string): Promise<string> {
      const response = await axios.get(`${previewUrl}/services/application/wmProperties.js`);
      return JSON.parse(response.data.split('=')[1].replace(';', '')).displayName;
    }

    clean(path: string) {
      if (fs.existsSync(path)) {
          rimraf.sync(path);
      }
      fs.mkdirSync(path, { recursive: true });
    }

    async setupCodeGen(projectDir: string){
      this.codegen = process.env.WAVEMAKER_STUDIO_FRONTEND_CODEBASE || '';
        
      if (this.codegen) {
          this.codegen = `${this.codegen}/wavemaker-rn-codegen/build`;
          const templatePackageJsonFile = path.resolve(`${process.env.WAVEMAKER_STUDIO_FRONTEND_CODEBASE}/wavemaker-rn-codegen/src/templates/project/package.json`);
          const packageJson = require(templatePackageJsonFile);
          if (semver.eq(packageJson["dependencies"]["expo"], "52.0.17")) {
              this.packageLockJsonFile = path.resolve(`${__dirname}/../../templates/package/packageLock.json`);
          }
      } else {
          const wmProjectDir = this.getWmProjectDir(projectDir);
          this.codegen = `${projectDir}/target/codegen/node_modules/@wavemaker/rn-codegen`;
          
          if (!fs.existsSync(`${this.codegen}/index.js`)) {
              const temp = projectDir + '/target/codegen';
              fs.mkdirSync(temp, { recursive: true });
              await exec('npm', ['init', '-y'], { cwd: temp });
              
              const pom = fs.readFileSync(`${projectDir}/pom.xml`, { encoding: 'utf-8' });
              const uiVersion = ((pom && pom.match(/wavemaker.app.runtime.ui.version>(.*)<\/wavemaker.app.runtime.ui.version>/)) || [])[1];
              
              await exec('npm', ['install', '--save-dev', `@wavemaker/rn-codegen@${uiVersion}`], { cwd: temp });
              
              const version = semver.coerce(uiVersion)?.version;
              if (version && semver.gte(version, '11.10.0')) {
                  this.rnAppPath = `${projectDir}/target/codegen/node_modules/@wavemaker/rn-app`;
                  await exec('npm', ['install', '--save-dev', `@wavemaker/rn-app@${uiVersion}`], { cwd: temp });
              }
          }
          
          await this.updateProfileConfig(projectDir);
      }
    }

    getLastModifiedTime(path: string): number {
      if (fs.existsSync(path)) {
          return fs.lstatSync(path).mtime.getTime();
      }
      return 0;
    }

    watchForPlatformChanges(callBack: () => Promise<void>): void {
      let codegen = process.env.WAVEMAKER_STUDIO_FRONTEND_CODEBASE;
      if (!codegen) {
          return;
      }
      setTimeout(() => {
          let currentModifiedTime = {
              'rn-runtime': this.getLastModifiedTime(`${codegen}/wavemaker-rn-runtime/dist/new-build`),
              'rn-codegen': this.getLastModifiedTime(`${codegen}/wavemaker-rn-codegen/dist/new-build`),
              'ui-variables': this.getLastModifiedTime(`${codegen}/wavemaker-ui-variables/dist/new-build`),
          };

          if (!this.lastKnownModifiedTime || !this.lastKnownModifiedTime['rn-runtime']) {
              this.lastKnownModifiedTime = currentModifiedTime;
          }
          
          const doBuild = this.lastKnownModifiedTime['rn-runtime'] < currentModifiedTime['rn-runtime']
                  || this.lastKnownModifiedTime['rn-codegen'] < currentModifiedTime['rn-codegen']
                  || this.lastKnownModifiedTime['ui-variables'] < currentModifiedTime['ui-variables'];

          this.lastKnownModifiedTime = currentModifiedTime;

          if (doBuild && callBack) {
              console.log('\n\n\n');
              logger.info({
                  label: this.getLoggerLabel(),
                  message: 'Platform Changed. Building again.'
              });
              callBack().then(() => {
                  this.watchForPlatformChanges(callBack);
              });
          } else {
              this.watchForPlatformChanges(callBack);
          }
      }, 5000);
    }
  
    async watchProjectChanges(previewUrl: string, onChange: () => void, lastModifiedOn?: string): Promise<void> {
      try {
        if(this.isExpoPreviewContainer){
          const response = await axios.get(`${previewUrl}/rn-bundle/index.bundle?minify=true&platform=web&dev=true&hot=false&transform.engine=hermes&transform.routerRoot=app&unstable_transformProfile=hermes-stable`, {
              headers: {
                  'if-none-match' : this.etag || ""
              }
          }).catch((e) => e.response);
          this.etag = response.headers.etag;
          if (response.status === 200) {
              onChange();
          }
        }else{
            const response = await axios.get(`${previewUrl}/rn-bundle/index.html`, {
                headers: {
                    'if-modified-since' : lastModifiedOn || new Date().toString()
                }
            }).catch((e) => e.response);
            if (response.status === 200 && response.data.indexOf('<title>WaveMaker Preview</title>') > 0) {
                lastModifiedOn = response.headers['last-modified'];
                onChange();
            }
        }
      } catch (e) {
          logger.error({
              label: this.getLoggerLabel(),
              message: e
          });
      }
      setTimeout(() => this.watchProjectChanges(previewUrl, onChange, lastModifiedOn), 5000);
    }

    async installDependencies(projectDir: string): Promise<void> {
        const startTime = Date.now();
        logger.info({
          label: this.getLoggerLabel(),
          message: 'Installing dependencies...'
        });      
        await exec('npm', ['install'], { cwd: projectDir });
        const endTime = Date.now();
        logger.info({
          label: this.getLoggerLabel(),
          message: `installDependencies completed in ${(endTime - startTime) / 1000}s`
        });
    }
    
    protected async configureProject(expoProjectDir: string, previewUrl: string): Promise<void> {
      if (this.packageLockJsonFile) {
          const generatedExpoPackageLockJsonFile = path.resolve(`${expoProjectDir}/package-lock.json`);
          await fs.copy(this.packageLockJsonFile, generatedExpoPackageLockJsonFile, { overwrite: false });
      }
    }

    async transpile(projectDir: string, previewUrl: string, incremental: boolean): Promise<void> {
      if(!this.codegen){
        await this.setupCodeGen(projectDir);
      }
      taskLogger.incrementProgress(2);

      const profile = this.getProfileName();
      const expoProjectDir = this.getExpoProjectDir(projectDir);

      await exec('node', [
        this.codegen, 
        'transpile', 
        `--profile="${profile}"`, 
        '--autoClean=false',
        `--incrementalBuild=${!!incremental}`,
        ...(this.rnAppPath ? [`--rnAppPath=${this.rnAppPath}`] : []),
        this.getWmProjectDir(projectDir), 
        expoProjectDir
      ]);
      taskLogger.incrementProgress(2);

      await this.configureProject(expoProjectDir, previewUrl);
    }
    
}