// Types of `recorder.mjs`, which stays plain JavaScript so that `init` can copy it as it is.
export declare const RECORDER_VERSION: number;
/** `command` with the session record's trailer added to each `git commit`, and each `git merge` that has a message. */
export declare function addTrailer(command: string, trailer: string): string;
