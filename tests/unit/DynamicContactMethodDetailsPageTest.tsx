import {act, render} from '@testing-library/react-native';

import HTMLEngineProvider from '@components/HTMLEngineProvider';

import * as UserActions from '@libs/actions/User';
import Navigation from '@libs/Navigation/Navigation';

import DynamicContactMethodDetailsPage from '@pages/settings/Profile/Contacts/DynamicContactMethodDetailsPage';

import ONYXKEYS from '@src/ONYXKEYS';

import {useIsFocused} from '@react-navigation/native';
import Onyx from 'react-native-onyx';

import type {MockFetch} from '../utils/TestHelper';

import {getGlobalFetchMock} from '../utils/TestHelper';
import waitForBatchedUpdates from '../utils/waitForBatchedUpdates';
import waitForBatchedUpdatesWithAct from '../utils/waitForBatchedUpdatesWithAct';

jest.mock('@react-navigation/native', () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const actualNav = jest.requireActual('@react-navigation/native');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return {
        ...actualNav,
        useIsFocused: jest.fn(() => true),
        useRoute: jest.fn(() => ({name: '', key: '', params: {}})),
        usePreventRemove: jest.fn(),
    };
});

jest.mock('@libs/Navigation/Navigation', () => ({
    getActiveRoute: jest.fn(() => ''),
    getActiveRouteWithoutParams: jest.fn(() => ''),
    isNavigationReady: jest.fn(() => Promise.resolve()),
    goBack: jest.fn(),
}));

jest.mock('@hooks/useDynamicBackPath', () => jest.fn(() => ''));

const useDynamicBackPathMock = jest.requireMock<jest.Mock>('@hooks/useDynamicBackPath');

jest.mock('@components/DelegateNoAccessModalProvider', () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const actual = jest.requireActual('@components/DelegateNoAccessModalProvider');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return {
        ...actual,
        useDelegateNoAccessState: () => ({isActingAsDelegate: false, isDelegateAccessRestricted: false}),
        useDelegateNoAccessActions: () => ({showDelegateNoAccessModal: jest.fn()}),
    };
});

jest.mock('@libs/actions/User', () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const originalModule = jest.requireActual('@libs/actions/User');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return {
        ...originalModule,
        resetContactMethodValidateCodeSentState: jest.fn(),
    };
});

function HTMLProviderWrapper({children}: {children: React.ReactNode}) {
    return <HTMLEngineProvider>{children}</HTMLEngineProvider>;
}

const fakeEmail = 'fake@gmail.com';
const contactMethodsListRoute = 'settings/profile/contact-methods';
const contactMethodDetailsRoute = `${contactMethodsListRoute}/fake%40gmail.com/details`;
// Force offline is toggled from the Test tools modal, which is opened with this page as backTo.
const testToolsRoute = `test-tools?backTo=${contactMethodDetailsRoute}`;
const mockRoute = {
    params: {
        contactMethod: fakeEmail,
    },
};
const mockLoginList = {
    [`1_${fakeEmail}`]: {
        partnerID: 1,
        partnerUserID: fakeEmail,
        validatedDate: 'fake-validatedDate',
    },
};

describe('DynamicContactMethodDetailsPage', () => {
    let mockFetch: MockFetch;
    beforeAll(() => {
        Onyx.init({
            keys: ONYXKEYS,
        });
    });
    beforeEach(() => {
        const globalFetchMock = getGlobalFetchMock();
        global.fetch = globalFetchMock;
        mockFetch = globalFetchMock;
        jest.mocked(Navigation.goBack).mockClear();
        // Online validation reads the live details route, which strips down to the contact methods list.
        jest.mocked(Navigation.getActiveRoute).mockReturnValue(contactMethodDetailsRoute);
        jest.mocked(useIsFocused).mockReturnValue(true);
        useDynamicBackPathMock.mockReturnValue(contactMethodsListRoute);
        return Onyx.clear().then(waitForBatchedUpdates);
    });

    function ContactMethodDetailsPageRenderer() {
        return (
            <HTMLProviderWrapper>
                <DynamicContactMethodDetailsPage
                    // @ts-expect-error - Ignoring type errors for testing purposes
                    route={mockRoute}
                />
            </HTMLProviderWrapper>
        );
    }

    it('should not call resetContactMethodValidateCodeSentState when we got a delete pending field', async () => {
        // Given a login list with a validated contact method
        Onyx.merge(ONYXKEYS.LOGINS, mockLoginList);
        await waitForBatchedUpdates();

        // Given the page is rendered
        render(<ContactMethodDetailsPageRenderer />);

        // When a deleteContactMethod called
        UserActions.deleteContactMethod(fakeEmail, mockLoginList);
        await waitForBatchedUpdatesWithAct();

        // When the deletion is successful
        mockFetch?.succeed();
        await waitForBatchedUpdates();
        mockFetch?.resume();
        await waitForBatchedUpdates();

        // Then resetContactMethodValidateCodeSentState should not be called
        expect(UserActions.resetContactMethodValidateCodeSentState).not.toHaveBeenCalled();
    });

    it('should not call resetContactMethodValidateCodeSentState when the login data has no partnerUserID', async () => {
        // Given a login list with a contact method that has no partnerUserID
        Onyx.merge(ONYXKEYS.LOGINS, {
            [`1_${fakeEmail}`]: {
                partnerID: 1,

                partnerUserID: '',
                validatedDate: '',
            },
        });
        await waitForBatchedUpdates();

        // Given the page is rendered
        render(<ContactMethodDetailsPageRenderer />);
        await waitForBatchedUpdatesWithAct();

        // Then resetContactMethodValidateCodeSentState should not be called
        expect(UserActions.resetContactMethodValidateCodeSentState).not.toHaveBeenCalled();
    });

    async function renderUnvalidatedContactMethod() {
        Onyx.merge(ONYXKEYS.SESSION, {email: fakeEmail});
        Onyx.merge(ONYXKEYS.IS_LOADING_REPORT_DATA, false);
        Onyx.merge(ONYXKEYS.LOGINS, {
            [`1_${fakeEmail}`]: {
                partnerID: 1,
                partnerUserID: fakeEmail,
                validatedDate: '',
            },
        });
        await waitForBatchedUpdates();

        const view = render(<ContactMethodDetailsPageRenderer />);
        await waitForBatchedUpdatesWithAct();
        return view;
    }

    async function validateContactMethod() {
        await act(async () => {
            Onyx.merge(ONYXKEYS.LOGINS, {
                [`1_${fakeEmail}`]: {
                    partnerID: 1,
                    partnerUserID: fakeEmail,
                    validatedDate: '2024-01-01',
                },
            });
        });
        await waitForBatchedUpdatesWithAct();
    }

    it('calls Navigation.goBack when contact method becomes validated and screen is focused', async () => {
        // Given an unvalidated contact method on the focused details page
        await renderUnvalidatedContactMethod();

        // When validation succeeds while this page is the live route
        await validateContactMethod();

        // Then the user is taken to the contact methods list
        expect(Navigation.goBack).toHaveBeenCalledTimes(1);
        expect(Navigation.goBack).toHaveBeenCalledWith(contactMethodsListRoute);
    });

    it('does not go back when an already validated contact method is opened', async () => {
        // Given a contact method that was validated before this page mounted, so there is no validation transition to follow
        Onyx.merge(ONYXKEYS.SESSION, {email: fakeEmail});
        Onyx.merge(ONYXKEYS.IS_LOADING_REPORT_DATA, false);
        Onyx.merge(ONYXKEYS.LOGINS, mockLoginList);
        await waitForBatchedUpdates();

        // When the details page opens
        render(<ContactMethodDetailsPageRenderer />);
        await waitForBatchedUpdatesWithAct();

        // Then opening the validated details must not bounce the user back to the list
        expect(Navigation.goBack).not.toHaveBeenCalled();
    });

    it('waits to go back while validation finishes under a covering modal', async () => {
        // Given the code is submitted on reconnect while Test tools still covers this page
        jest.mocked(useIsFocused).mockReturnValue(false);
        jest.mocked(Navigation.getActiveRoute).mockReturnValue(testToolsRoute);
        useDynamicBackPathMock.mockReturnValue(testToolsRoute);
        await renderUnvalidatedContactMethod();

        // When validation succeeds before the modal closes
        await validateContactMethod();

        // Then we must not go back to Test tools, which would replace the settings pane
        expect(Navigation.goBack).not.toHaveBeenCalled();
    });

    it('goes back to the contact methods list when focus returns before the rendered back path catches up', async () => {
        // Given validation finished while Test tools covered this page, so the rendered back path is still that modal
        jest.mocked(useIsFocused).mockReturnValue(false);
        jest.mocked(Navigation.getActiveRoute).mockReturnValue(testToolsRoute);
        useDynamicBackPathMock.mockReturnValue(testToolsRoute);
        const {rerender} = await renderUnvalidatedContactMethod();
        await validateContactMethod();

        // When the modal closes and focus returns one render before the rendered back path updates,
        // while the live route is already this details page
        jest.mocked(useIsFocused).mockReturnValue(true);
        jest.mocked(Navigation.getActiveRoute).mockReturnValue(contactMethodDetailsRoute);
        rerender(<ContactMethodDetailsPageRenderer />);
        await waitForBatchedUpdatesWithAct();

        // Then we go back to the list, not to the Test tools route that was just closed
        expect(Navigation.goBack).toHaveBeenCalledTimes(1);
        expect(Navigation.goBack).toHaveBeenCalledWith(contactMethodsListRoute);
    });

    it('does not go back to a modal that is still the live route when focus flips', async () => {
        // Given validation finished under Test tools
        jest.mocked(useIsFocused).mockReturnValue(false);
        jest.mocked(Navigation.getActiveRoute).mockReturnValue(testToolsRoute);
        useDynamicBackPathMock.mockReturnValue(testToolsRoute);
        const {rerender} = await renderUnvalidatedContactMethod();
        await validateContactMethod();

        // When focus is reported before the navigator state has left Test tools
        jest.mocked(useIsFocused).mockReturnValue(true);
        rerender(<ContactMethodDetailsPageRenderer />);
        await waitForBatchedUpdatesWithAct();

        // Then we stay put instead of replacing the settings pane with Test tools
        expect(Navigation.goBack).not.toHaveBeenCalled();

        // When the live route and the rendered back path both settle on this page
        jest.mocked(Navigation.getActiveRoute).mockReturnValue(contactMethodDetailsRoute);
        useDynamicBackPathMock.mockReturnValue(contactMethodsListRoute);
        rerender(<ContactMethodDetailsPageRenderer />);
        await waitForBatchedUpdatesWithAct();

        // Then the deferred navigation runs once, to the contact methods list
        expect(Navigation.goBack).toHaveBeenCalledTimes(1);
        expect(Navigation.goBack).toHaveBeenCalledWith(contactMethodsListRoute);
    });
});
