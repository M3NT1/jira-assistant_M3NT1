import { useEffect, useState } from 'react';

import classNames from 'classnames';

import { Button, Loading } from '@components';

import { gadgetList, type GadgetInfo } from '../../../gadgets/gadget-list';

interface AddGadgetProps {
    show: boolean;
    onHide: () => void;
    addedGadgets: Array<{ name: string; settings?: any }>;
    addGadget: (gadgetId: string, settings?: any) => void;
    removeGadget: (gadgetId: string) => void;
}

export function AddGadget({ show, onHide, addedGadgets, addGadget, removeGadget }: AddGadgetProps) {
    const [gadgets, setGadgets] = useState<GadgetInfo[] | null>(null);

    useEffect(() => {
        if (show && !gadgets) {
            loadGadgetList();
        }
    }, [show, gadgets]);

    const loadGadgetList = async () => {
        // Report viewers are not migrated to v3 yet (gadget-registry maps CR/AR/SQ to a
        // placeholder), so saved reports are deliberately not offered here: adding one
        // would only produce an empty card. Restore this once a viewer exists.
        setGadgets(gadgetList);
    };

    const containerClassName = classNames(
        'fixed top-12 right-0 h-[calc(100vh-3rem)] border-l border-(--border-primary) overflow-hidden bg-(--bg-primary) transition-all duration-300 z-40 shadow-(--shadow-lg)',
        {
            'w-[350px]': show,
            'w-0': !show,
        },
    );

    return (
        <div className={containerClassName}>
            <div className="h-full w-[350px] overflow-y-auto">
                <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-2.5 bg-(--bg-tertiary) border-b border-(--border-primary)">
                    <h2 className="font-semibold text-sm text-primary">Add a Gadget</h2>
                    <Button layout="plain" leftIcon={<i className="fa fa-times" />} onClick={onHide} title="Close" />
                </div>
                <div className="px-4 pb-4">
                    {!gadgets && <Loading />}
                    {gadgets?.map((gadget) => (
                        <GadgetItem
                            key={gadget.id}
                            gadget={gadget}
                            addedGadgets={addedGadgets}
                            addGadget={addGadget}
                            removeGadget={removeGadget}
                        />
                    ))}
                </div>
            </div>
        </div>
    );
}

interface GadgetItemProps {
    gadget: GadgetInfo;
    addedGadgets: Array<{ name: string; settings?: any }>;
    addGadget: (gadgetId: string, settings?: any) => void;
    removeGadget: (gadgetId: string) => void;
}

function GadgetItem({ gadget, addedGadgets, addGadget, removeGadget }: GadgetItemProps) {
    const added = addedGadgets.some((w: any) => w.name === gadget.id);

    const handleAdd = () => addGadget(gadget.id);
    const handleRemove = () => removeGadget(gadget.id);

    return (
        <div className="w-full py-3 border-b border-(--border-primary)">
            <div className="mb-2">
                <span className="block font-semibold leading-tight text-primary">{gadget.name}</span>
                <span className="block pt-2 text-sm text-secondary">{gadget.details}</span>
            </div>
            <div className="mt-2">
                {!added && (
                    <Button
                        variant="default"
                        leftIcon={<i className="fa fa-plus" />}
                        label="Add"
                        disabled={gadget.isOld}
                        onClick={handleAdd}
                        size="sm"
                    />
                )}
                {added && (
                    <Button variant="default" leftIcon={<i className="fa fa-times" />} onClick={handleRemove} size="sm">
                        Remove
                    </Button>
                )}
            </div>
        </div>
    );
}
