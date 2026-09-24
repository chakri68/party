import { register, start } from "./router.ts";
import { HomeView } from "./views/home.ts";
import { RoomView } from "./views/room.ts";
import "./style.css";

register("/", () => new HomeView());
register("/room/:code", (params) => new RoomView(params));

start(document.getElementById("app")!);
