import React, { forwardRef } from "react";

/** The desktop target has no Next router. Shared UI links retain native
 * anchor semantics, including accessible names, refs and click cancellation.
 * Only the desktop Vite configuration resolves next/link to this adapter. */
const DesktopLink = forwardRef<HTMLAnchorElement, React.AnchorHTMLAttributes<HTMLAnchorElement>>(
  function DesktopLink(props, ref) {
    return <a {...props} ref={ref} />;
  },
);

export default DesktopLink;
