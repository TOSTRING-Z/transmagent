/** 鼠标位置接口 */
interface MousePosition {
    x: number;
    y: number;
    [key: string]: any;
}
/**
 * 执行二进制文件并捕获鼠标位置
 * @returns 包含 x, y 坐标的对象
 */
export declare function captureMouse(): Promise<MousePosition>;
export {};
