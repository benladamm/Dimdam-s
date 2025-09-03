export interface TranslateOptions {
  from?: string;
  to?: string;
  raw?: boolean;
  maxChunkChars?: number;
}

export interface TranslateResult {
  text: string;
  from: {
    language: { didYouMean: boolean; iso: string };
    text: { autoCorrected: boolean; value: string; didYouMean: boolean };
  };
  raw: any;
}

export type Translator = (text: string, options?: TranslateOptions) => Promise<TranslateResult>;

export interface LanguagesApi {
  [code: string]: string;
  isSupported(lang: string): boolean;
  getISOCode(lang: string): string | null | false;
}

export interface LoadTranslations {
  [lang: string]: { [word: string]: string };
}

export interface LoaderOptions {
  include?: string[];
  exclude?: string[];
  watch?: boolean;
}

export interface CommandModule {
  name: string;
  [key: string]: any;
}

export type Loader = (client: { commands: Map<string, CommandModule> }, basePath: string, silent?: boolean, options?: LoaderOptions) => Promise<any>;

export const translator: Translator & { languages: LanguagesApi; loadLanguages(languages: string[], words: string[]): Promise<LoadTranslations>; };
export const loader: Loader;
