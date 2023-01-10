import intl from 'react-intl-universal';
import { Checkbox, Dropdown, Modal, Pivot, PivotItem, PrimaryButton, Spinner, Stack, TextField, Toggle } from '@fluentui/react';
import { observer } from 'mobx-react-lite';
import { FC, useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import dayjs from 'dayjs';
import { useGlobalStore } from '../../store';
import { downloadFileFromBlob, getKRFParseMap, IKRFComponents } from '../../utils/download';
import { LoginPanel } from '../../pages/loginInfo/account';
import { CloudItemType } from '../../pages/dataSource/selection/cloud/space';
import { notify } from '../error';
import { CloudAccessModifier } from '../../interfaces';
import { writeDatasetFile, writeNotebookFile } from './utils';

const Cont = styled.div`
    padding: 1em;
    width: 400px;
    .modal-header{
        h3{
            font-size: 1.5em;
        }
        margin-bottom: 6px;
    }
    .modal-footer{
        margin-top: 1em;
    }
    .login {
        padding: 0.6em 1em 1em;
    }
`

const BackupModal: FC = (props) => {
    const { commonStore, dataSourceStore, collectionStore, causalStore, dashboardStore, userStore } = useGlobalStore();
    const { cloudDataSourceMeta, cloudDatasetMeta, datasetId, sourceType } = dataSourceStore;
    const { id: dataSourceId } = cloudDataSourceMeta ?? {};
    const { showBackupModal } = commonStore;
    const { info, loggedIn } = userStore;
    const rawDataLength = dataSourceStore.rawDataMetaInfo.length;
    const mutFieldsLength = dataSourceStore.mutFields.length;
    const collectionLength = collectionStore.collectionList.length;
    const [mode, setMode] = useState(CloudItemType.NOTEBOOK);
    
    const [dataSourceName, setDataSourceName] = useState<string | null>(null);
    const [modifiableDataSourceName, setModifiableDataSourceName] = useState('');
    const defaultDataSourceName = `${datasetId || 'unnamed'}`;
    useEffect(() => {
        if (cloudDataSourceMeta === null) {
            setDataSourceName(null);
        } else {
            setDataSourceName(cloudDataSourceMeta.name);
        }
    }, [cloudDataSourceMeta, userStore]);
    const dsName = dataSourceName || modifiableDataSourceName || datasetId;

    const [name, setName] = useState('');
    const defaultName = useMemo(() => {
        if (dsName) {
            return `${dsName} - ${dayjs().format('YYYY-MM-DD HHmm')}`;
        }
        return intl.get('storage.default_name', {
            date: dayjs().format('YYYY-MM-DD HHmm'),
            mode: intl.get(`dataSource.importData.cloud.${mode}`),
        });
    }, [dsName, mode]);

    const [datasetOverwrite, setDatasetOverwrite] = useState(true);
    
    const [busy, setBusy] = useState(false);
    const [backupItemKeys, setBackupItemKeys] = useState<{
        [key in IKRFComponents]: boolean;
    }>({
        [IKRFComponents.data]: rawDataLength > 0,
        [IKRFComponents.meta]: mutFieldsLength > 0,
        [IKRFComponents.collection]: collectionLength > 0,
        [IKRFComponents.causal]: false,
        [IKRFComponents.dashboard]: false,
        [IKRFComponents.mega]: false,
    });
    useEffect(() => {
        setBackupItemKeys({
            data: rawDataLength > 0,
            meta: mutFieldsLength > 0,
            collection: collectionLength > 0,
            causal: false,
            dashboard: false,
            mega: false
        })
    }, [rawDataLength, mutFieldsLength, collectionLength]);
    const organizations = info?.organizations;
    const [selectedOrgId, setSelectedOrgId] = useState<number | null>(null);
    const workspaces = organizations?.find(org => org.id === selectedOrgId)?.workspaces;
    const [selectedWspId, setSelectedWspId] = useState<number | null>(null);
    const [accessMode, setAccessMode] = useState(CloudAccessModifier.PUBLIC);
    const canBackup =  selectedWspId !== null && (mode === CloudItemType.NOTEBOOK ? (
        Object.values(backupItemKeys).some(Boolean)
    ) : (
        (cloudDataSourceMeta && cloudDatasetMeta) || !datasetOverwrite || !cloudDatasetMeta
    ));
    useEffect(() => {
        setSelectedOrgId(null);
    }, [organizations]);
    useEffect(() => {
        setSelectedWspId(null);
        if (selectedOrgId !== null) {
            userStore.getWorkspaces(selectedOrgId);
        }
    }, [selectedOrgId, userStore]);
    // const storageItems =
    const backup = async (download = false) => {
        if (!download && (busy || !canBackup || selectedWspId === null)) {
            return false;
        }
        setBusy(true);
        if (mode === CloudItemType.NOTEBOOK) {
            const parseMapItems = getKRFParseMap(backupItemKeys);
            const file = await writeNotebookFile(parseMapItems, name || defaultName);
            if (download) {
                downloadFileFromBlob(file, file.name);
            } else {
                const ok = await userStore.uploadNotebook(selectedWspId!, file);
                if (ok) {
                    commonStore.setShowBackupModal(false);
                }
            }
        } else if (mode === CloudItemType.DATASET) {
            const [file, nRows, meta] = await writeDatasetFile(name || defaultName);
            if (download) {
                downloadFileFromBlob(file, file.name);
            } else {
                let dsId = dataSourceId;
                if (dsId === undefined) {
                    const dataSourceSaveRes = await dataSourceStore.saveDataSourceOnCloud<'online'>({
                        name: modifiableDataSourceName || defaultDataSourceName,
                        workspaceId: selectedWspId!,
                        datasourceType: sourceType,
                        linkInfo: {},
                    });
                    if (dataSourceSaveRes) {
                        const dataSource = await userStore.fetchDataSource(selectedWspId!, dataSourceSaveRes.id);
                        if (dataSource) {
                            dataSourceStore.setCloudDataSource(dataSource, selectedWspId!);
                            dsId = dataSourceStore.cloudDataSourceMeta?.id;
                        }
                    }
                }
                if (dsId) {
                    await dataSourceStore.saveDatasetOnCloud({
                        datasourceId: dsId,
                        name: name || defaultName,
                        workspaceId: selectedWspId!,
                        type: accessMode,
                        size: file.size,
                        totalCount: nRows,
                        meta,
                    }, file);
                    commonStore.setShowBackupModal(false);
                } else {
                    notify({
                        type: 'error',
                        title: 'Backup Dataset',
                        content: 'DatasourceID is empty',
                    });
                }
            }
        }
        setBusy(false);
    };
    const items: {
        key: IKRFComponents;
        text: string;
        disabled?: boolean;
    }[] = [
        {
            key: IKRFComponents.data,
            text: intl.get('storage.components.data', { size: rawDataLength }),
        },
        {
            key: IKRFComponents.meta,
            text: intl.get('storage.components.meta', { size: mutFieldsLength }),
        },
        {
            key: IKRFComponents.collection,
            text: intl.get('storage.components.collection', { size: collectionLength }),
        },
        {
            key: IKRFComponents.causal,
            text: intl.get('storage.components.causal'),
            disabled: !causalStore.model.causality,
        },
        {
            key: IKRFComponents.dashboard,
            text: intl.get('storage.components.dashboard', { size: dashboardStore.pages.length }),
        },
    ];
    return (
        <Modal
            isOpen={showBackupModal}
            onDismiss={() => commonStore.setShowBackupModal(false)}
            isBlocking={false}
            containerClassName="modal-container"
        >
            <Cont>
                {loggedIn || process.env.NODE_ENV === 'development' ? (
                    <>
                        <div className="modal-header">
                            <h3>{intl.get('storage.upload')}</h3>
                        </div>
                        <Pivot selectedKey={mode} onLinkClick={item => item?.props.itemKey && setMode(item.props.itemKey as CloudItemType)} styles={{ root: { marginBlock: '1em' } }}>
                            <PivotItem itemKey={CloudItemType.NOTEBOOK} headerText={intl.get(`dataSource.importData.cloud.${CloudItemType.NOTEBOOK}`)}>
                                <p className='state-description'>{intl.get('storage.upload_desc', { mode: intl.get(`dataSource.importData.cloud.${CloudItemType.NOTEBOOK}`) })}</p>
                                <Stack tokens={{ childrenGap: 10 }} style={{ marginTop: '1em' }}>
                                    {items.map((item) => (
                                        <Stack.Item key={item.key}>
                                            <Checkbox
                                                label={item.text}
                                                disabled={item.disabled}
                                                checked={backupItemKeys[item.key as keyof typeof backupItemKeys]}
                                                onChange={(e, checked) => {
                                                    setBackupItemKeys({
                                                        ...backupItemKeys,
                                                        [item.key]: checked,
                                                    });
                                                }}
                                            />
                                        </Stack.Item>
                                    ))}
                                </Stack>
                                <Stack style={{ margin: '0.6em 0' }}>
                                    <Dropdown
                                        label={intl.get('user.organization')}
                                        options={(organizations ?? []).map(org => ({
                                            key: `${org.id}`,
                                            text: org.name,
                                        }))}
                                        required
                                        selectedKey={`${selectedOrgId}`}
                                        onChange={(_, option) => option && setSelectedOrgId(Number(option.key))}
                                    />
                                    <Dropdown
                                        label={intl.get('user.workspace')}
                                        disabled={!Array.isArray(workspaces)}
                                        options={(workspaces ?? []).map(wsp => ({
                                            key: `${wsp.id}`,
                                            text: wsp.name,
                                        }))}
                                        required
                                        selectedKey={`${selectedWspId}`}
                                        onChange={(_, option) => option && setSelectedWspId(Number(option.key))}
                                    />
                                    <TextField
                                        label={intl.get('storage.name', { mode: intl.get(`dataSource.importData.cloud.${CloudItemType.NOTEBOOK}`) })}
                                        value={name}
                                        placeholder={defaultName}
                                        onChange={(_, val) => setName(val ?? '')}
                                        required
                                    />
                                </Stack>
                            </PivotItem>
                            <PivotItem itemKey={CloudItemType.DATASET} headerText={intl.get(`dataSource.importData.cloud.${CloudItemType.DATASET}`)}>
                                <p className='state-description'>{intl.get('storage.upload_desc', { mode: intl.get(`dataSource.importData.cloud.${CloudItemType.DATASET}`) })}</p>
                                <Stack style={{ margin: '0.6em 0' }}>
                                    {cloudDatasetMeta && (
                                        <Toggle
                                            label={intl.get('storage.overwrite')}
                                            checked={datasetOverwrite}
                                            onChange={(_, checked) => setDatasetOverwrite(Boolean(checked))}
                                        />
                                    )}
                                    {cloudDataSourceMeta && cloudDatasetMeta && datasetOverwrite ? (
                                        <>
                                            <TextField
                                                label={intl.get('storage.data_source_name')}
                                                value={cloudDataSourceMeta.name}
                                                readOnly
                                            />
                                            <TextField
                                                label={intl.get('storage.name', { mode: intl.get(`dataSource.importData.cloud.${CloudItemType.DATASET}`) })}
                                                value={cloudDatasetMeta.name}
                                                readOnly
                                            />
                                            <Toggle
                                                label={intl.get('storage.public')}
                                                checked={cloudDatasetMeta.type === CloudAccessModifier.PUBLIC}
                                                onChange={() => void 0}
                                            />
                                        </>
                                    ) : (
                                        <>
                                            <Dropdown
                                                label={intl.get('user.organization')}
                                                options={(organizations ?? []).map(org => ({
                                                    key: `${org.id}`,
                                                    text: org.name,
                                                }))}
                                                required
                                                selectedKey={`${selectedOrgId}`}
                                                onChange={(_, option) => option && setSelectedOrgId(Number(option.key))}
                                            />
                                            <Dropdown
                                                label={intl.get('user.workspace')}
                                                disabled={!Array.isArray(workspaces)}
                                                options={(workspaces ?? []).map(wsp => ({
                                                    key: `${wsp.id}`,
                                                    text: wsp.name,
                                                }))}
                                                required
                                                selectedKey={`${selectedWspId}`}
                                                onChange={(_, option) => option && setSelectedWspId(Number(option.key))}
                                            />
                                            <TextField
                                                label={intl.get('storage.data_source_name')}
                                                value={dataSourceName ?? modifiableDataSourceName}
                                                readOnly={dataSourceName !== null}
                                                placeholder={defaultDataSourceName}
                                                onChange={(_, val) => setModifiableDataSourceName(val ?? '')}
                                                required
                                            />
                                            <TextField
                                                label={intl.get('storage.name', { mode: intl.get(`dataSource.importData.cloud.${CloudItemType.DATASET}`) })}
                                                value={name}
                                                placeholder={defaultName}
                                                onChange={(_, val) => setName(val ?? '')}
                                                required
                                            />
                                            <Toggle
                                                label={intl.get('storage.public')}
                                                checked={accessMode === CloudAccessModifier.PUBLIC}
                                                onChange={(_, checked) => setAccessMode(checked ? CloudAccessModifier.PUBLIC : CloudAccessModifier.PROTECTED)}
                                            />
                                        </>
                                    )}
                                </Stack>
                            </PivotItem>
                        </Pivot>
                        <div className="modal-footer">
                            <PrimaryButton disabled={!canBackup || busy} onClick={() => backup()}>
                                {busy && <Spinner style={{ transform: 'scale(0.8)', transformOrigin: '0 50%' }} />}
                                {intl.get('storage.apply')}
                            </PrimaryButton>
                            {process.env.NODE_ENV === 'development' && (
                                <button onClick={() => backup(true)}>
                                    Download File (dev)
                                </button>
                            )}
                        </div>
                    </>
                ) : (
                    <div className="login">
                        <div className="modal-header">
                            <h3>{intl.get('login.login')}</h3>
                        </div>
                        <LoginPanel />
                    </div>
                )}
            </Cont>
        </Modal>
    );
};

export default observer(BackupModal);
