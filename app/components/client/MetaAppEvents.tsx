"use client";

import { useEffect } from "react";
import { startMetaAppEvents } from "@/lib/metaAppEvents";

/** Startar Meta App Events en gång per appstart (bara i iOS-appen). */
export default function MetaAppEvents() {
  useEffect(() => {
    void startMetaAppEvents();
  }, []);
  return null;
}
