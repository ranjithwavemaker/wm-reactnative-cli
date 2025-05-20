const { htmlDecode } = require('htmlencode') as { htmlDecode: (input: string) => string };
import { exec as childExec, ExecOptions } from 'child_process';
import { escape } from 'shell-argument-escape';
import * as Path from 'path';
import { promisify } from 'util';

const execAsync = promisify(childExec);

interface TeamInfo {
  name: string;
  id: string;
}

interface ProfileInfo {
  uuid: string;
  team: TeamInfo;
  appid: string;
  name: string;
  type: 'appstore' | 'inhouse' | 'adhoc' | 'dev';
  cers: string[];
}

function exec(cmd: string, opt?: ExecOptions): Promise<string> {
  const options = Object.assign({ cwd: __dirname }, opt);
  return new Promise((resolve, reject) => {
    childExec(cmd, options, (err, stdout, stderr) => {
      if (err) {
        reject(stderr);
      } else {
        resolve(stdout ?? '');
      }
    });
  });
}

function getVal(xml: string, name: string): string {
  const m = new RegExp(`<key>${name}<\\/key>\\n\\s*<string>(.+)<\\/string>`);
  const match = xml.match(m);
  if (!match) {
    throw new Error(`Key ${name} not found in XML`);
  }
  return htmlDecode(match[1]);
}

function getType(xml: string): ProfileInfo['type'] {
  if (xml.includes('<key>ProvisionsAllDevices</key>')) {
    return 'inhouse';
  }
  if (!xml.includes('<key>ProvisionedDevices</key>')) {
    return 'appstore';
  }
  if (xml.match(/<key>get-task-allow<\/key>\n\s*<true\/>/)) {
    return 'dev';
  }
  return 'adhoc';
}

function getInfo(xml: string): ProfileInfo {
  const info: ProfileInfo = {
    uuid: getVal(xml, 'UUID'),
    team: {
      name: getVal(xml, 'TeamName'),
      id: getVal(xml, 'com.apple.developer.team-identifier'),
    },
    appid: getVal(xml, 'application-identifier'),
    name: getVal(xml, 'Name'),
    type: getType(xml),
    cers: [],
  };

  const certMatch = xml.match(
    /<key>DeveloperCertificates<\/key>\n\s*<array>\n\s*((?:<data>\S+?<\/data>\n\s*)+)<\/array>/
  );
  if (certMatch) {
    info.cers = certMatch[1].match(/[^<>]{10,}/g) || [];
  } else {
    info.cers = [];
  }

  return info;
}

function main(profilePath: string, cb?: (info: ProfileInfo) => void): Promise<ProfileInfo> {
  const cmd = `security cms -D -i ${escape(Path.resolve(profilePath))}`;
  return exec(cmd).then((stdout) => {
    const info = getInfo(stdout);
    if (typeof cb === 'function') {
      cb(info);
    }
    return info;
  });
}

export default main;
