interface HIDDeviceFilter {
  vendorId?: number;
  productId?: number;
  usagePage?: number;
  usage?: number;
}

interface HIDCollectionInfo {
  usagePage?: number;
  usage?: number;
  type?: number;
  children?: HIDCollectionInfo[];
}

interface HIDConnectionEvent extends Event {
  readonly device: HIDDevice;
}

interface HIDInputReportEvent extends Event {
  readonly device: HIDDevice;
  readonly reportId: number;
  readonly data: DataView;
}

interface HID extends EventTarget {
  onconnect: ((event: HIDConnectionEvent) => void) | null;
  ondisconnect: ((event: HIDConnectionEvent) => void) | null;
  getDevices(): Promise<HIDDevice[]>;
  requestDevice(options: { filters: HIDDeviceFilter[] }): Promise<HIDDevice[]>;
}

interface HIDDevice extends EventTarget {
  readonly opened: boolean;
  readonly vendorId: number;
  readonly productId: number;
  readonly productName: string;
  readonly collections: HIDCollectionInfo[];
  open(): Promise<void>;
  close(): Promise<void>;
  sendReport(reportId: number, data: BufferSource): Promise<void>;
  addEventListener(
    type: "inputreport",
    listener: (event: HIDInputReportEvent) => void,
    options?: AddEventListenerOptions | boolean
  ): void;
  removeEventListener(
    type: "inputreport",
    listener: (event: HIDInputReportEvent) => void,
    options?: EventListenerOptions | boolean
  ): void;
}

interface Navigator {
  hid?: HID;
}
