import { Dialog, type DialogProps } from "./dialog";
export type DrawerProps=Omit<DialogProps,"variant">;
export function Drawer(props:DrawerProps){return <Dialog {...props} variant="drawer"/>;}
