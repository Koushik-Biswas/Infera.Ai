import { Config } from "@remotion/cli/config";

// Quality-first defaults for the marketing master.
Config.setVideoImageFormat("jpeg");
Config.setJpegQuality(95);
Config.setPixelFormat("yuv420p");
Config.setCodec("h264");
Config.setCrf(16);
Config.setConcurrency(2); // 2-core laptop; raise on bigger machines
Config.setOverwriteOutput(true);
Config.setChromiumOpenGlRenderer("angle");
