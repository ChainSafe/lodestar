import React from "react";
import "./ErrorView.scss";

export function ErrorView({error}: {error: Error | string}): JSX.Element {
  const {message, detail} = parseError(error);

  return (
    <div className="error-view red">
      {detail ? (
        <details>
          <summary>{message.split("\n")[0]}</summary>
          <pre>{detail}</pre>
        </details>
      ) : (
        <span className="only-summary">{message}</span>
      )}
    </div>
  );
}

function parseError(error: Error | string): {message: string; detail?: string} {
  if (error instanceof Error) return {message: error.message, detail: error.stack};
  if (typeof error === "string") return {message: error};
  return {message: JSON.stringify(error), detail: ""};
}
