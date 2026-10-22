import { BrandingPreviewFrame } from "./branding-preview-frame";

type BrandingPreviewChromeProps = {
  name: string;
  basePath: string;
  urlLabel: string;
  params: Record<string, string>;
};

export function BrandingPreviewChrome({
  name,
  basePath,
  urlLabel,
  params,
}: BrandingPreviewChromeProps) {
  return (
    <div className="flex h-[450px] justify-center lg:h-full lg:min-h-[450px]">
      <div className="relative h-full w-full max-w-[698px] rounded-lg bg-gray-200 p-1 shadow-lg">
        <div className="relative flex h-full flex-col overflow-hidden rounded-lg bg-gray-100">
          <div className="relative mx-auto flex h-7 w-full shrink-0 items-center justify-center">
            <div className="pointer-events-none absolute left-3 flex flex-row">
              <div className="mr-1 size-2 rounded-full bg-gray-300" />
              <div className="mr-1 size-2 rounded-full bg-gray-300" />
              <div className="mr-1 size-2 rounded-full bg-gray-300" />
            </div>

            <div className="flex items-center justify-center rounded-xl bg-white px-2 py-1 opacity-70">
              <div
                aria-hidden="true"
                className="mr-1 mt-0.5 flex text-muted-foreground"
              >
                <svg
                  height="8"
                  width="8"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path d="M8.75 11.25a1.25 1.25 0 1 0-1.5 0v1a.75.75 0 0 0 1.5 0v-1Z" />
                  <path
                    fillRule="evenodd"
                    clipRule="evenodd"
                    d="M3.5 4v2h-1a1 1 0 0 0-1 1v6a3 3 0 0 0 3 3h7a3 3 0 0 0 3-3V7a1 1 0 0 0-1-1h-1V4a4 4 0 0 0-4-4h-1a4 4 0 0 0-4 4ZM11 6V4a2.5 2.5 0 0 0-2.5-2.5h-1A2.5 2.5 0 0 0 5 4v2h6Zm-8 7V7.5h10V13a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 13Z"
                  />
                </svg>
              </div>

              <span className="whitespace-normal text-xs text-muted-foreground">
                {urlLabel}
              </span>
            </div>
          </div>

          <div className="relative min-h-0 flex-1 overflow-x-auto">
            <div className="relative h-full max-w-[1396px]">
              <BrandingPreviewFrame
                name={name}
                basePath={basePath}
                params={params}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
