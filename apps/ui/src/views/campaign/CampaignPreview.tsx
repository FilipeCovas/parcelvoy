import { useContext, useMemo, useState, useEffect, useCallback } from 'react'
import { CampaignContext, LocaleContext, ProjectContext } from '../../contexts'
import SourceEditor from '@monaco-editor/react'
import './CampaignPreview.css'
import api from '../../api'
import Preview from '../../ui/Preview'
import { toast } from 'react-hot-toast'
import { debounce } from '../../utils'
import Heading from '../../ui/Heading'
import LocaleSelector from './LocaleSelector'
import Alert from '../../ui/Alert'
import Button from '../../ui/Button'
import { Column, Columns } from '../../ui/Columns'
import TextInput from '../../ui/form/TextInput'
import ButtonGroup from '../../ui/ButtonGroup'
import Modal, { ModalProps } from '../../ui/Modal'
import { SearchTable, useSearchTableState } from '../../ui/SearchTable'
import { ChannelType, TemplateProofParams, User } from '../../types'
import FormWrapper from '../../ui/form/FormWrapper'

interface UserLookupProps extends Omit<ModalProps, 'title'> {
    onSelected: (user: User) => void
}

const UserLookup = ({ open, onClose, onSelected }: UserLookupProps) => {
    const [project] = useContext(ProjectContext)
    const state = useSearchTableState(useCallback(async params => await api.users.search(project.id, params), [project]))
    const [value, setValue] = useState<string>('')

    return <Modal
        title="User Lookup"
        open={open}
        onClose={onClose}
        size="regular">
        <div className="user-lookup">
            <ButtonGroup>
                <TextInput<string> name="search" placeholder="Enter email..." onChange={setValue} />
                <Button onClick={() => state.setParams({
                    ...state.params,
                    q: value,
                })}>Search</Button>
            </ButtonGroup>
            <SearchTable
                {...state}
                columns={[
                    { key: 'full_name', title: 'Name' },
                    { key: 'email' },
                    { key: 'phone' },
                ]}
                onSelectRow={(user) => {
                    onSelected(user)
                    onClose(false)
                }} />
        </div>
    </Modal>
}

interface SendProofProps extends Omit<ModalProps, 'title'> {
    type: ChannelType
    onSubmit: (recipient: string) => Promise<void>
}

const SendProof = ({ open, onClose, onSubmit, type }: SendProofProps) => {
    return (
        <Modal
            open={open}
            onClose={onClose}
            title="Send Proof"
            description={`Enter the ${type === 'email' ? 'email address' : 'phone number'} of the recipient you want to receive the proof of this template.`}>
            <FormWrapper<TemplateProofParams>
                onSubmit={async ({ recipient }) => await onSubmit(recipient)}>
                {form => (
                    <TextInput.Field form={form} name="recipient" required />
                )}
            </FormWrapper>
        </Modal>
    )
}

export default function CampaignPreview() {

    const [project] = useContext(ProjectContext)
    const campaignState = useContext(CampaignContext)
    const [{ currentLocale }] = useContext(LocaleContext)
    const openState = useState(false)
    const [isUserLookupOpen, setIsUserLookupOpen] = useState(false)
    const [isSendProofOpen, setIsSendProofOpen] = useState(false)
    const template = campaignState[0].templates.find(template => template.locale === currentLocale?.key)

    if (!template) {
        return (<>
            <Heading title="Preview" size="h3" actions={
                <LocaleSelector
                    campaignState={campaignState}
                    openState={openState} />
            } />
            <Alert
                variant="plain"
                title="Add Template"
                body="There are no templates yet for this campaign. Add a locale above or use the button below to get started"
                actions={<Button onClick={() => openState[1](true)}>Create Template</Button>}
            />
        </>)
    }

    const [data, setData] = useState(template.data)
    const [value, setValue] = useState<string | undefined>('{\n    "user": {},\n    "event": {}\n}')
    useEffect(() => { handleEditorChange(value) }, [value, template])

    const handleEditorChange = useMemo(() => debounce(async (value?: string) => {
        const { data } = await api.templates.preview(project.id, template.id, JSON.parse(value ?? '{}'))
        setData(data)
    }), [template])

    const handleSendProof = async (recipient: string) => {
        await api.templates.proof(project.id, template.id, {
            variables: JSON.parse(value ?? '{}'),
            recipient,
        })
        setIsSendProofOpen(false)
        toast.success('Template proof has been successfully sent!')
    }

    return (
        <>
            <Heading title="Preview" size="h3" actions={
                <LocaleSelector
                    campaignState={campaignState}
                    openState={openState} />
            } />
            <Columns>
                <Column>
                    <Heading title="Data" size="h4" actions={
                        <Button
                            size="small"
                            variant="secondary"
                            onClick={() => setIsUserLookupOpen(true)}
                        >Load User</Button>
                    } />
                    <div className="preview-source-editor">
                        <SourceEditor
                            defaultLanguage="json"
                            defaultValue={value}
                            value={value}
                            onChange={setValue}
                            options={{ wordWrap: 'on' }}
                            theme="vs-dark"
                        />
                    </div>
                </Column>
                <Column>
                    <Heading title="Preview" size="h4" actions={
                        <Button
                            size="small"
                            variant="secondary"
                            onClick={() => setIsSendProofOpen(true)}>Send Proof</Button>
                    } />
                    <Preview template={{ type: template.type, data }} />
                </Column>
            </Columns>

            <UserLookup
                open={isUserLookupOpen}
                onClose={setIsUserLookupOpen}
                onSelected={user => {
                    setValue(JSON.stringify({
                        user,
                        event: {},
                    }, undefined, 4))
                }} />
            <SendProof
                open={isSendProofOpen}
                onClose={setIsSendProofOpen}
                onSubmit={handleSendProof}
                type={template.type} />
        </>
    )
}
