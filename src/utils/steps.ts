export interface Step {
    step: number;
    start: string;
    stop: string;
    succeed: string;
    fail: string;
    info: string;
    warn: string;
    total: number;
}

export const previewSteps: Step[] = [
    {
        step: 1,
        start: "Setting up directories",
        stop: "",
        succeed: "Setup directories finished",
        fail: "Setup directories failed",
        info: "",
        warn: "",
        total: 1,
    },
    {
        step: 2,
        start: "Authenticating user",
        stop: "",
        succeed: "Authentication successful",
        fail: "Authentication failed",
        info: "",
        warn: "",
        total: 1,
    },
    {
        step: 3,
        start: "Downloading project",
        stop: "",
        succeed: "Project downloaded",
        fail: "Project download failed",
        info: "",
        warn: "",
        total: 5
    },
    {
        step: 4,
        start: "Transpiling project",
        stop: "",
        succeed: "Project transpiled successfully",
        fail: "Transpiling project failed",
        info: "",
        warn: "",
        total: 6
    },
    {
        step: 5,
        start: "Installing dependencies",
        stop: "",
        succeed: "Dependencies installed",
        fail: "Dependencies installation failed",
        info: "",
        warn: "",
        total: 4
    },
    {
        step: 6,
        start: "Launching servie proxy",
        stop: "",
        succeed: "Service proxy launched",
        fail: "Service proxy launch failed",
        info: "",
        warn: "",
        total: 3
    },
];

export const esbuildWebPreviewSteps: Step[] = [
    {
        step: 1,
        start: "Setting up directories",
        stop: "",
        succeed: "Setup directories finished",
        fail: "Setup directories failed",
        info: "",
        warn: "",
        total: 1,
    },
    {
        step: 2,
        start: "Authenticating user",
        stop: "",
        succeed: "Authentication successful",
        fail: "Authentication failed",
        info: "",
        warn: "",
        total: 1,
    },
    {
        step: 3,
        start: "Downloading project",
        stop: "",
        succeed: "Project downloaded",
        fail: "Project download failed",
        info: "",
        warn: "",
        total: 5
    },
    {
        step: 4,
        start: "Transpiling project",
        stop: "",
        succeed: "Project transpiled successfully",
        fail: "Transpiling project failed",
        info: "",
        warn: "",
        total: 6
    },
    {
        step: 5,
        start: "Installing dependencies",
        stop: "",
        succeed: "Dependencies installed",
        fail: "Dependencies installation failed",
        info: "",
        warn: "",
        total: 4
    },
    {
        step: 6,
        start: "Launching servie proxy",
        stop: "",
        succeed: "Service proxy launched",
        fail: "Service proxy launch failed",
        info: "",
        warn: "",
        total: 3
    },
];

export const expoWebPreviewSteps: Step[] = [
    {
        step: 1,
        start: "Setting up directories",
        stop: "",
        succeed: "Setup directories finished",
        fail: "Setup directories failed",
        info: "",
        warn: "",
        total: 1,
    },
    {
        step: 2,
        start: "Authenticating user",
        stop: "",
        succeed: "Authentication successful",
        fail: "Authentication failed",
        info: "",
        warn: "",
        total: 1,
    },
    {
        step: 3,
        start: "Downloading project",
        stop: "",
        succeed: "Project downloaded",
        fail: "Project download failed",
        info: "",
        warn: "",
        total: 5
    },
    {
        step: 4,
        start: "Transpiling project",
        stop: "",
        succeed: "Project transpiled successfully",
        fail: "Transpiling project failed",
        info: "",
        warn: "",
        total: 6
    },
    {
        step: 5,
        start: "Updating web preview configuration",
        stop: "",
        succeed: "Web preview configuration updated",
        fail: "Web preview configuration update failed",
        info: "",
        warn: "",
        total: 1
    },
    {
        step: 6,
        start: "Installing dependencies",
        stop: "",
        succeed: "Dependencies installed",
        fail: "Dependencies installation failed",
        info: "",
        warn: "",
        total: 4
    },
    {
        step: 7,
        start: "Applying node patches",
        stop: "",
        succeed: "Patches applied successfully",
        fail: "Patches application failed",
        info: "",
        warn: "",
        total: 1
    },
    {
        step: 8,
        start: "Launching servie proxy",
        stop: "",
        succeed: "Service proxy launched",
        fail: "Service proxy launch failed",
        info: "",
        warn: "",
        total: 3
    },
];

export const buildSteps: Step[] = [
    {
        step: 1,
        start: "Setting up build directories",
        stop: "",
        succeed: "Project directories successfully set up.",
        fail: "Failed to set up project directories.",
        info: "",
        warn: "",
        total: 6
    },
    {
        step: 2,
        start: "Verifying prerequisites...",
        stop: "",
        succeed: "All required prerequisites are met.",
        fail: "Missing or incompatible prerequisites detected.",
        info: "",
        warn: "",
        total: 2
    },
    {
        step: 3,
        start: "Installing dependencies...",
        stop: "",
        succeed: "All dependencies installed successfully.",
        fail: "Dependency installation failed.",
        info: "",
        warn: "",
        total: 4
    },
    {
        step: 4,
        start: "Ejecting project configuration...",
        stop: "",
        succeed: "Project ejected successfully.",
        fail: "Project ejection failed.",
        info: "",
        warn: "",
        total: 2
    },
    {
        step: 5,
        start: "Generating Artifact...",
        stop: "",
        succeed: "Build successful! APK/IPA generated.",
        fail: "Build failed! Error generating APK/IPA.",
        info: "",
        warn: "",
        total: 2,
    },
];

export function calculateTotalSteps(steps: Step[]): number {
    return steps.reduce((sum, step) => sum + (step.total || 0), 0);
}