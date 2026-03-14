let stopRequested = false;

export function requestStop(): void {
    stopRequested = true;
}

export function isStopRequested(): boolean {
    return stopRequested;
}
