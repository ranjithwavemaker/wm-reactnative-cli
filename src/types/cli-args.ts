export interface BaseArgs {
    _: string[];
    [key: string]: any;
}

export interface BuildArgs extends BaseArgs {
    platform?: 'android' | 'ios';
    src: string;
    dest?: string;
    appId?: string;
    aks?: string;
    asp?: string;
    aka?: string;
    akp?: string;
    p?: 'apk' | 'bundle';
    architecture?: string[];
    ic?: string;
    icp?: string;
    ipf?: string;
    bt?: 'development' | 'debug' | 'production' | 'release';
    localrnruntimepath?: string;
    autoEject?: boolean;
}

export interface EjectArgs extends BaseArgs {
    src?: string;
    dest?: string;
}

export interface EmbedArgs extends BaseArgs {
    platform?: 'android' | 'ios';
    src?: string;
    dest?: string;
    modulePath?: string;
}

export interface WebArgs extends BaseArgs {
    previewUrl?: string;
    clean?: boolean;
    useProxy?: boolean;
    web?: boolean;
    proxyHost?: string;
    basePath?: string;
    esbuild?: boolean;
}

export interface SyncArgs extends BaseArgs {
    previewUrl?: string;
    clean?: boolean;
    useProxy?: boolean;
}
