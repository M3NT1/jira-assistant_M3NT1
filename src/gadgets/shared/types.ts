import { GadgetActionTypeValue } from '@constants';

import { ExportFormat } from '../../common/Exporter';

export interface GadgetAction {
    type: GadgetActionTypeValue;
    data?: any;
}

export interface GadgetModel {
    name: string;
    settings?: Record<string, any>;
}

export interface BaseGadgetProps {
    isGadget?: boolean;
    tabLayout?: boolean;
    tabHeaderSlot?: HTMLElement | null;
    /**
     * Set when the surrounding layout already provides the panel frame, header and
     * drag handling (the resizable grid). The gadget then renders only its content and
     * portals its header buttons into hostHeaderSlot.
     */
    hostedChrome?: boolean;
    hostHeaderSlot?: HTMLElement | null;
    index?: number;
    model?: GadgetModel;
    settings?: Record<string, any>;
    layout?: number;
    onAction?: (action: GadgetAction, model?: GadgetModel, index?: number) => void;
    draggableHandle?: ((node: HTMLDivElement | null) => void) | null;
    dropProps?: { dropRef: ((node: HTMLDivElement | null) => void) | null };
    gadgetType?: string;
}

export interface BaseGadgetConfig {
    title: string;
    hideRefresh?: boolean;
    hideMenu?: boolean;
    hideExport?: boolean;
    hideCSVExport?: boolean;
    hideXLSXExport?: boolean;
    hidePDFExport?: boolean;
    exportFormat?: typeof ExportFormat;
    className?: string;
}
